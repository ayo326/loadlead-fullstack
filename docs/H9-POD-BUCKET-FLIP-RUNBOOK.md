# H9 POD bucket flip runbook (audit v6 phase 4, SCRUM-59)

Operator runbook for the final POD-bucket hardening on `loadlead-pod-uploads`.
This is a gated, human-run apply. Read the whole document before running.

## What the Step-0 baseline review found (important)

The Phase 4 config was drafted to "privatize a public bucket." When the live
baseline was captured before applying, the reality was different and better:

- **The bucket is already private.** Every public-URL style
  (`loadlead-pod-uploads.s3.amazonaws.com/<key>`, path style, regional) returns
  **403**. There is no public bucket policy, no public bucket ACL, and no public
  object ACL.
- **The live bucket policy is a bespoke self-protection** (`DenyDeleteAndPolicyTamper`):
  it denies the EB role `s3:DeleteObject`/`DeleteObjectVersion` AND
  `s3:PutBucketPolicy`/`DeleteBucketPolicy`/`PutLifecycleConfiguration`/
  `PutBucketVersioning` on the bucket and its objects. That is STRONGER than a
  plain deny-all-deletes.
- **The public-access-block is partial:** `BlockPublicAcls` + `IgnorePublicAcls`
  are true, but `BlockPublicPolicy` + `RestrictPublicBuckets` are FALSE.

So Phase 4 was reduced to two safe, additive actions, and the live delete/tamper
policy is left exactly as-is (managing it in Terraform would REGRESS it):

1. Tighten the public-access-block: set all four flags true, so no future public
   bucket policy can ever take effect.
2. Codify the backend EB role's `s3:GetObject`/`PutObject` grant on the bucket
   (additive; the out-of-band grant already exists).

Phases 2 and 3 already moved every read to a short-lived signed GET behind the
chain-party resolver with an access-log write, and capped uploads via presigned
POST. Nothing depends on public reads.

## Safety model

- **Terraform never owns the bucket.** The config attaches the public-access-
  block and an IAM role grant **by bucket name**; it never imports the
  `aws_s3_bucket`. TF cannot delete the bucket, and no object is touched.
- **The PAB change is additive.** It grants nothing and removes no current,
  legitimate access. All reads are signed URLs by authorized principals, and
  there is no public policy for `RestrictPublicBuckets` to restrict.
- **The live delete/tamper policy is untouched.** We do not manage it in TF.

## Preconditions

- [ ] Phase 2 (signed serving + access log) deployed and verified in prod.
- [ ] Phase 3 (size-capped presigned POST uploads) deployed and verified in prod.
- [ ] A driver headshot renders in prod today (signed-headshot path is live).
- [ ] You can run `tofu` against `infra/terraform/envs/prod` with prod creds.

## Step 0 - confirm the baseline still holds

```
aws s3api get-bucket-policy --bucket loadlead-pod-uploads --query Policy --output text
aws s3api get-public-access-block --bucket loadlead-pod-uploads
# legacy public GET on a real key -> expect 403 already:
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://loadlead-pod-uploads.s3.amazonaws.com/<a-known-pod-key>"
```

**HARD STOP** if any of these is now different from the review above - in
particular, if the live policy contains a public-read grant, or the bucket is
reachable publicly (200). That would mean the world changed since this runbook
was written; re-plan before applying.

## Step 1 - staging

The staging bucket `loadlead-staging-pod-uploads` is already PAB-private with all
four flags true, so it is already at the target posture. There is nothing to
apply on staging for this change; it is the proof that the all-true PAB posture
runs cleanly (staging has served signed POD/headshot reads under it all along).

## Step 2 - prod plan review

```
cd infra/terraform/envs/prod
tofu init -input=false
tofu plan \
  -target=aws_s3_bucket_public_access_block.pod_uploads_v1 \
  -target=aws_iam_role_policy.pod_uploads_v1_backend_access
```

Expect exactly **two resources to ADD** and NOTHING to change or destroy:

- `aws_s3_bucket_public_access_block.pod_uploads_v1`
- `aws_iam_role_policy.pod_uploads_v1_backend_access`

**HARD STOP** if the plan shows any `destroy`, any `aws_s3_bucket_policy`, any
change to a DynamoDB table, the EB environment, a KMS key, or any bucket other
than `loadlead-pod-uploads`. The Phase 4 config touches none of those.

## Step 3 - apply

```
tofu apply \
  -target=aws_s3_bucket_public_access_block.pod_uploads_v1 \
  -target=aws_iam_role_policy.pod_uploads_v1_backend_access
```

Using `-target` scopes the apply to exactly these two resources so unrelated
drift in the large prod stack is never applied as a side effect.

## Step 4 - verify

```
aws s3api get-public-access-block --bucket loadlead-pod-uploads
# Expect all four flags true now.

aws s3api get-bucket-policy --bucket loadlead-pod-uploads --query Policy --output text
# Expect the SAME DenyDeleteAndPolicyTamper policy as before (unchanged).

curl -s -o /dev/null -w "%{http_code}\n" \
  "https://loadlead-pod-uploads.s3.amazonaws.com/<a-known-pod-key>"
# Still 403.
```

Also confirm the app still works: a driver headshot renders, and a POD read via
`GET /api/attestation/photos/:photoId/url` returns a working signed URL for a
chain party.

## Definition of done

- [ ] `get-public-access-block` shows all four flags true.
- [ ] The live `DenyDeleteAndPolicyTamper` bucket policy is unchanged.
- [ ] Legacy public object URL still returns 403.
- [ ] Signed serve route returns 200 for a chain party, 403 for a non-party.
- [ ] Driver headshot renders in prod (signed path).
- [ ] POD upload (presigned POST) still succeeds end to end.

## Rollback

Posture change, not data change - objects are never touched. To revert the PAB:
`tofu destroy -target=aws_s3_bucket_public_access_block.pod_uploads_v1`
returns `BlockPublicPolicy`/`RestrictPublicBuckets` to false. The bucket stays
private regardless (no public policy or ACL exists). Prefer leaving it hardened.

## Not in this step (Phase 5)

Removing the POD `publicUrl` write path from the app, the repo-wide sweep for
public POD URL construction, and the full DoD test matrix are Phase 5.
