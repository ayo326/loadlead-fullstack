# H9 POD bucket flip runbook (audit v6 phase 4, SCRUM-59)

Operator runbook for privatizing the live POD bucket `loadlead-pod-uploads` in
place. This is the consequential, human-run apply that the Phase 4 PR
deliberately does NOT perform. Read the whole document before running anything.

## What this does and why

PODs are proof-of-delivery evidence: signatures, addresses, legal artifacts.
Historically the bucket served public reads via a stored `publicUrl`. Phases 2
and 3 replaced that: every read now goes through a short-lived signed GET behind
the chain-party resolver (`assertChainReadAccess`) with an access-log write, and
uploads are size-capped presigned POSTs. Nothing in the app depends on public
reads anymore. This step closes the bucket to the public.

## Safety model (read this first)

- **Terraform never owns the bucket.** `loadlead-pod-uploads` was created
  out-of-band and is NOT a managed `aws_s3_bucket` resource. The Phase 4 config
  (`infra/terraform/envs/prod/pod-uploads-v1-privatize.tf`) attaches only three
  sub-resources by bucket NAME: a public-access-block, a bucket policy, and an
  IAM role grant. TF cannot delete the bucket, and no object is ever deleted by
  this change.
- **The public-access-block is the real control.** With
  `restrict_public_buckets` and `ignore_public_acls` true, S3 ignores any public
  statement still on the live policy and any public ACL. The bucket is private
  the instant the PAB applies, independent of the policy swap.
- **The policy swap preserves delete-resistance.** The codified bucket policy is
  a byte-for-byte copy of the proven `pod-uploads-v2` / `compliance-docs`
  deny-all-deletes. It replaces the live out-of-band policy, dropping the
  now-inert public-read statement and keeping deletes denied.
- **The IAM grant is additive.** The backend EB role already has an out-of-band
  Get/Put grant on this bucket; the codified inline policy only adds, never
  removes.

## Preconditions (all must hold)

- [ ] Phase 2 (signed serving path + access log) deployed and verified in prod.
- [ ] Phase 3 (size-capped presigned POST uploads) deployed and verified in prod.
- [ ] A driver headshot renders in prod today (proves the signed-headshot path
      is live, since headshots are the only stored-publicUrl reader).
- [ ] You can run `tofu` against `infra/terraform/envs/prod` and `.../staging`
      with prod credentials.

## Step 0 - capture the live baseline (do not skip)

```
# Current public status (expect a public-read grant present today):
aws s3api get-bucket-policy --bucket loadlead-pod-uploads \
  --query Policy --output text | tee /tmp/pod-v1-policy-BEFORE.json
aws s3api get-public-access-block --bucket loadlead-pod-uploads \
  2>&1 | tee /tmp/pod-v1-pab-BEFORE.json
aws s3api get-bucket-acl --bucket loadlead-pod-uploads \
  | tee /tmp/pod-v1-acl-BEFORE.json
```

**HARD STOP:** open `/tmp/pod-v1-policy-BEFORE.json`. The live policy is expected
to contain exactly (a) a public-read `s3:GetObject` grant and (b) a
deny-all-deletes. If it contains any OTHER statement (an extra principal, a
cross-account grant, a replication or logging statement), do NOT proceed - the
codified policy would drop it. Reconcile first: fold that statement into
`pod-uploads-v1-privatize.tf` before applying, or hand the diff back for review.

## Step 1 - staging first

The staging bucket `loadlead-staging-pod-uploads` is already PAB-private; the
staging change in this PR adds the same deny-all-deletes policy, so the
policy-after-PAB mechanic is exercised there first.

```
cd infra/terraform/envs/staging
tofu init -input=false
tofu plan -out=pod.plan          # expect: 1 to add (aws_s3_bucket_policy.pod_uploads_no_delete)
tofu apply pod.plan
```

Verify on staging: a POD/headshot read still returns 200 via the signed serve
route, and `aws s3api delete-object --bucket loadlead-staging-pod-uploads --key
<any-test-key>` is denied. Only then move to prod.

## Step 2 - prod plan review

```
cd infra/terraform/envs/prod
tofu init -input=false
tofu plan -out=pod.plan
```

Expect exactly three resources to ADD, and NOTHING to change or destroy:

- `aws_s3_bucket_public_access_block.pod_uploads_v1`
- `aws_s3_bucket_policy.pod_uploads_v1_no_delete`
- `aws_iam_role_policy.pod_uploads_v1_backend_access`

**HARD STOP** if the plan shows any `destroy`, any change to a DynamoDB table,
the EB environment, a KMS key, or any bucket other than `loadlead-pod-uploads`.
The Phase 4 config touches none of those.

## Step 3 - apply (staged; conservative path recommended)

### 3a. Privatize only (the reversible control)

```
tofu apply -target=aws_s3_bucket_public_access_block.pod_uploads_v1
```

### 3b. Verify privatization BEFORE codifying the policy

```
# A previously public object key. Expect 403 now (was 200 before the flip):
curl -s -o /dev/null -w "legacy public GET -> %{http_code}\n" \
  "https://loadlead-pod-uploads.s3.amazonaws.com/<a-known-pod-or-headshot-key>"

# The signed serve path still works for a chain party (expect a 200 body):
#   GET /api/attestation/photos/:photoId/url  with a shipper/hauler/driver token
# A driver headshot still renders in the app (Settings / profile).
```

If the legacy public GET is not 403, stop and investigate before continuing.

### 3c. Codify the policy + grant (after Step 0 review passed)

```
tofu apply pod.plan     # applies the remaining two resources
```

`tofu apply pod.plan` is safe to run whole; the `-target` in 3a just lets you
verify the privatization in isolation first. If you prefer a single apply, run
`tofu apply pod.plan` once and verify 3b immediately after.

## Step 4 - confirm the public grant is gone

```
aws s3api get-bucket-policy --bucket loadlead-pod-uploads \
  --query Policy --output text
# Expect ONLY the DenyAllDeletes statement. No public-read statement remains
# (TF replaced the policy; the PAB would ignore it regardless).

aws s3api get-public-access-block --bucket loadlead-pod-uploads
# Expect all four flags true.
```

If for any reason a public statement lingers out-of-band (it should not after
the policy replace), remove it:
`aws s3api delete-bucket-policy` is NOT appropriate (it would drop deny-delete).
Instead re-put the codified policy via `tofu apply`.

## Definition of done

- [ ] Legacy public object URL returns 403.
- [ ] Signed serve route returns 200 for a chain party and 403 for a non-party.
- [ ] Driver headshot renders in prod (signed path).
- [ ] POD upload (presigned POST) still succeeds end to end.
- [ ] `get-public-access-block` shows all four true.
- [ ] Bucket policy contains only DenyAllDeletes.
- [ ] `delete-object` against the bucket is denied.

## Rollback

The change is a posture change, not a data change - objects are never touched.
To re-open temporarily (only if a broken read is traced to privatization):
`tofu destroy -target=aws_s3_bucket_public_access_block.pod_uploads_v1`
re-exposes the bucket to whatever the policy allows. Prefer fixing the signed
read path over re-opening. Re-applying restores the private posture.

## Not in this step (Phase 5)

Removing the POD `publicUrl` write path from the app, the repo-wide sweep for
public POD URL construction, and the full DoD test matrix are Phase 5. This
runbook only flips the bucket.
