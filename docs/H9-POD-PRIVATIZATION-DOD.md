# H9 POD privatization - definition of done (audit v6, SCRUM-59)

PODs are proof-of-delivery evidence (signatures, addresses, legal artifacts).
This is the closeout matrix for making them private end to end: every invariant,
how it is enforced, and where it is proven. Phases 1-5 complete.

## Invariant matrix

| # | Invariant | Enforced by | Proof |
|---|-----------|-------------|-------|
| 1 | No POD/headshot object is publicly accessible | Bucket public-access-block all-four-true; no public policy or ACL | Live (phase 4): raw public GET returns 403 on a real key; `get-public-access-block` all true |
| 2 | Authorized reads still work | Signed GET by an authorized principal | Live (phase 4): presigned GET returns 200 on the same key |
| 3 | Every read goes through ONE resolver | `assertChainReadAccess(load, userId, role)` - shipper OR hauler OR driver OR receiver OR admin | `podServeRoute.test`: party gets URL, non-party gets 403 |
| 4 | Reads are access-logged, fail-closed | `recordPodAccess` written BEFORE the URL is minted | `podServeRoute.test`: party -> log written; non-party -> no log, no URL |
| 5 | Signed URLs are short-lived + configurable | `signedPodGetUrl(key, ttl)`, TTL from `config.pod.*` | `podStorage.test`: TTL pass-through (POD 300s, headshot 3600s) |
| 6 | A signed URL is NEVER stored | Store `key`, sign at serve time | `headshotSigning.test`: read re-signs, never returns the stored URL; `updateProfile` guard drops any client `headshotUrl` |
| 7 | Upload size cap enforced by the POLICY, not the UI | `createPresignedPost` `content-length-range [1, POD_MAX_UPLOAD_BYTES]` | `podUpload.test`: policy carries the byte cap |
| 8 | Upload MIME allowlist enforced server-side | `pinUploadMime` -> 415 off-list | `podUpload.test`: `application/pdf` etc. rejected 415 |
| 9 | Only the load's driver (or admin) can mint a POD upload | `driver.ts` POD route 403 if `load.assignedDriverId !== driver.driverId` | Route guard; live: unauth -> 401 |
| 10 | Packet assemblers reference PODs privately | `podRef` is a key/id, never a public URL | Repo sweep: zero `publicUrl`, zero `s3.amazonaws.com` construction in app code |
| 11 | Legacy `publicUrl` records 403 after the flip | Bucket private; legacy rows re-signed at read from the derived key | Live (phase 4): 403 on a legacy key; `headshotSigning.test` legacy-row case |
| 12 | The bucket cannot be deleted or its objects removed | Not TF-managed (attached by name); live `DenyDeleteAndPolicyTamper` policy | Phase 4 apply: 0 destroy; live policy unchanged (6 deny actions incl PutBucketPolicy) |

## Phase log

- **Phase 1** - recon: PODs already key-based; the driver headshot was the only stored-`publicUrl` reader; bucket is out-of-band, direct-S3.
- **Phase 2** (PR #99) - signed serving path: `GET /api/attestation/photos/:photoId/url` (resolver + access log + signed GET); headshot signed at profile read; `LoadLead_PodAccessLog` table.
- **Phase 3** (PR #100) - size-capped presigned POST uploads (policy-enforced cap + MIME); FE multipart POST.
- **Phase 4** (PR #101 built, PR #102 reconciled, applied) - bucket hardening. Step-0 review found the bucket already private with a superior live delete/tamper policy, so this reduced to PAB all-four-true + codified EB role grant; the live policy is left untouched.
- **Phase 5** (this change) - cleanup: removed the last vestigial `uploadUrl` references, added the `updateProfile` never-persist-a-URL guard, and this DoD matrix.

## Sweep result (phase 5)

`grep -rn "publicUrl"` and public-S3-URL construction across `backend/src` +
`frontend-v2/src`: **zero occurrences**. The POD/headshot `publicUrl` write path
is fully gone; nothing constructs a public object URL.

## Constraints held throughout

No em/en dashes; the Load model was never modified; keys/caps/buckets come from
config; signed URLs are never stored; infra changes were plan-reviewed and
human-applied, never silent; no object was ever deleted.
