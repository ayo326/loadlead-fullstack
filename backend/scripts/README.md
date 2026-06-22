# backend/scripts

One-off operational scripts. Keep them small and idempotent.

## bootstrapAdmin.mjs

**Provision the first platform ADMIN. This is the only supported path.**

The `/api/setup/*` HTTP routes are disabled by default (`ALLOW_ADMIN_BOOTSTRAP`
must be `'true'` in the runtime env to enable, which prod and staging do not
set). Per the Part B security audit (LL-AC-004 CAT-I), bootstrap from a public
web form is a CAT-I violation: race-condition on the existence check + no rate
limiting + no audit trail. The HTTP route hardening reduces the exposure but
the **CLI remains the canonical way**.

### Run it (prod, with AWS creds in env)

```bash
# from the repo root
node backend/scripts/bootstrapAdmin.mjs \
  --email founder@your-org.com \
  --name  "Your Display Name"
# omit --password to be prompted (recommended)
```

The script:

1. Loads `.env` (DynamoDB endpoint, region, table names).
2. Refuses to run if an `ADMIN` already exists in `LoadLead_Users`.
3. Writes a fixed-PK singleton marker (`userId = '__admin_singleton__'`) with
   a `ConditionExpression: attribute_not_exists(userId)`. Two concurrent runs
   cannot both succeed — DynamoDB rejects the loser.
4. Creates the real ADMIN row with bcrypt-hashed password.
5. Prints the new `userId` so you can paste it into your password manager.

### Reset the singleton (rare — e.g. after wiping the table)

```bash
aws dynamodb delete-item \
  --table-name LoadLead_Users \
  --key '{"userId":{"S":"__admin_singleton__"}}'
```

Only do this if you've also removed every ADMIN row.

## seedLocalUsers.mjs

Seeds the local DynamoDB Local tables with the dev-tier test accounts. Idempotent.

## createTables.mjs

Creates the LoadLead_* tables in DynamoDB Local. Idempotent.
