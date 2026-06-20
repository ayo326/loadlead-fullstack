---
connie-title: Database & Analytics — Operator Provisioning Checklist
connie-publish: true
---

# LoadLead Analytics DB — Operator Provisioning Checklist

> Companion to `LoadLead_Analytics_DB_Spec.md`. The application code does **not**
> provision infrastructure (spec §6). This document is everything you (the
> operator) need to do in AWS / with a telematics provider before I can wire
> the analytics replica and dashboards to real data.
>
> Two independent tiers:
> 1. **Geospatial / build-now tier** — PostGIS + RDS + DynamoDB Streams.
>    Ships independently. No external provider needed.
> 2. **Telematics tier** — HOS, reefer, GPS, diagnostics, fuel cards, CSA
>    scores. Gated on a third-party provider. Until connected, every
>    telematics-derived dashboard field renders **"Connect <X>"**, never zeros.

---

## TIER 1 — Geospatial (Build-now)

Provision these and the analytics replica goes live. Total set-up time: **~45 min**
in the AWS console. Monthly cost at the build-now tier: **~$25–40/mo** (db.t4g.small
+ 50 GB gp3 + Lambda invocations from DynamoDB Streams).

### 1.1 RDS PostgreSQL with PostGIS

| Setting | Value |
|---|---|
| Engine | PostgreSQL **16.4** or newer |
| Instance class | **db.t4g.small** (2 vCPU, 2 GB RAM) — sufficient for build-now |
| Storage | **gp3, 50 GB** initial |
| Multi-AZ | No (build-now). Yes for production resilience later. |
| Public access | **No** — same VPC as the Elastic Beanstalk backend |
| VPC | Same VPC as `loadlead-backend-prod` env |
| Subnets | Private subnets of that VPC |
| DB name | `loadlead_analytics` |
| Master username | `loadlead_admin` |
| Master password | Generate a strong random one — store in Secrets Manager (§1.4) |
| Backup retention | 7 days minimum |
| Encryption | KMS — use the default `aws/rds` key, or your own CMK |
| Parameter group | Custom — needed to enable `pg_cron` (see §1.7) |

**Steps:**
1. AWS Console → RDS → **Create database**
2. Standard create → PostgreSQL → version 16.4
3. **Templates**: Production (for default reliability settings)
4. Settings + DB instance fields as above
5. Connectivity → **Don't connect to an EC2 compute resource** (we'll attach manually)
6. Choose the EB env's VPC. Subnet group: private.
7. Public access: **No**
8. VPC security group: **Create new** → name `loadlead-analytics-rds-sg`
9. **Additional configuration** → Initial database name: `loadlead_analytics`
10. Click **Create database**. Provisioning takes ~10 min.

---

### 1.2 Connection string (single secret)

Once the instance is **Available**:

1. RDS → your DB → **Connectivity & security** → copy the **Endpoint**
2. Build the URL in this exact format (SSL required on RDS):

   ```
   postgres://loadlead_admin:<URL-ENCODED-PASSWORD>@<endpoint>:5432/loadlead_analytics?sslmode=require
   ```

   Notes:
   - URL-encode the password if it contains `@`, `:`, `/`, `?`, `#`, or `%`
     (use `python3 -c "import urllib.parse; print(urllib.parse.quote('your-pass'))"`).
   - The default port is 5432 — change only if you customized it.

3. Hand this URL to me as **`ANALYTICS_DATABASE_URL`** (see §1.4 — it goes
   into Secrets Manager, never into env vars or files).

---

### 1.3 VPC + security-group connectivity

The stream consumer (Lambda) and the backend (Elastic Beanstalk) both need
to reach the RDS instance on port 5432. The RDS instance only allows
connections from security groups you explicitly trust.

**Add these inbound rules to `loadlead-analytics-rds-sg`:**

| Type | Protocol | Port | Source | Description |
|---|---|---|---|---|
| PostgreSQL | TCP | 5432 | Source: the **EB instance security group** (e.g. `awseb-…`) | Backend reads MVs |
| PostgreSQL | TCP | 5432 | Source: the **Lambda function's security group** (created in §1.5) | Stream consumer writes |

VPC → Security Groups → select `loadlead-analytics-rds-sg` → **Edit inbound
rules** → add the two rules above.

Outbound: leave the default (allow all) — Lambda/EB only need to reach the DB.

---

### 1.4 AWS Secrets Manager — analytics secret

Spec §6: the connection string is a secret. Never put it in a `.env` file or
in code.

1. AWS Console → Secrets Manager → **Store a new secret**
2. **Secret type**: Other type of secret
3. **Key/value pairs**:
   - Key: `ANALYTICS_DATABASE_URL`
   - Value: the connection string from §1.2
4. Encryption key: default (`aws/secretsmanager`) is fine
5. **Secret name**: `loadlead/analytics/db`
6. Resource permissions — leave default for now (least-privilege via IAM role)
7. Rotation: enable later with the **Lambda rotation** option; not required for build-now
8. Click **Store**

**Note the secret ARN** — I'll need it to grant the stream consumer Lambda
permission to read it.

---

### 1.5 IAM role for the stream consumer Lambda

The Lambda function reads DynamoDB Streams (read-only) and writes to RDS via
the secret. **No write permissions to DynamoDB.**

1. IAM → Roles → **Create role**
2. Use case: **Lambda**
3. Attach these AWS-managed policies:
   - `AWSLambdaBasicExecutionRole` (CloudWatch logs)
   - `AWSLambdaVPCAccessExecutionRole` (run inside the VPC to reach RDS)
4. **Create policy** (inline) called `loadlead-analytics-stream-consumer`
   with this JSON (replace `552011299815` with your account if different):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadDynamoDBStreams",
         "Effect": "Allow",
         "Action": [
           "dynamodb:DescribeStream",
           "dynamodb:GetRecords",
           "dynamodb:GetShardIterator",
           "dynamodb:ListStreams"
         ],
         "Resource": [
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Loads/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Offers/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Drivers/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_OwnerOperators/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Organizations/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Memberships/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Verifications/stream/*",
           "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_FactoringOptIns/stream/*"
         ]
       },
       {
         "Sid": "ReadAnalyticsSecret",
         "Effect": "Allow",
         "Action": ["secretsmanager:GetSecretValue"],
         "Resource": "arn:aws:secretsmanager:us-east-1:552011299815:secret:loadlead/analytics/db-*"
       }
     ]
   }
   ```

5. **Role name**: `loadlead-analytics-stream-consumer-role`
6. **Tags**: `app=loadlead`, `tier=analytics`

⚠️ **Verify the role has NO write permissions to DynamoDB.** The stream
consumer is read-only on Dynamo by spec — if you accidentally grant
`PutItem` / `UpdateItem` / `DeleteItem`, that's a compliance violation
(LL-AC-001).

---

### 1.6 Enable DynamoDB Streams on the 8 source tables

Stream image type: **New and old images** (spec §3 requires both — old image
needed to compute deltas, new image needed to update read models).

Tables:
1. `LoadLead_Loads`
2. `LoadLead_Offers`
3. `LoadLead_Drivers`
4. `LoadLead_OwnerOperators`
5. `LoadLead_Organizations`
6. `LoadLead_Memberships`
7. `LoadLead_Verifications`
8. `LoadLead_FactoringOptIns`

**For each table:**

1. DynamoDB Console → Tables → select the table → **Exports and streams** tab
2. **DynamoDB stream details** → **Turn on**
3. View type: **New and old images**
4. Click **Turn on stream**
5. **Copy the stream ARN** (looks like `arn:aws:dynamodb:us-east-1:…:table/LoadLead_Loads/stream/2026-…`)

Send me all 8 stream ARNs as a list — I'll wire each one to the Lambda
trigger.

**Free**: streams have no per-stream cost, only per-record read cost
(charged via the Lambda invocations).

---

### 1.7 Enable pg_partman + pg_cron on RDS

`pg_partman` is needed for the partitioned `load_status_events` table (spec
§2.2). `pg_cron` runs the materialized-view refresh schedule (spec §4).
Both are on the RDS PostgreSQL allow-list.

**Custom parameter group setup:**

1. RDS → Parameter groups → **Create parameter group**
2. Family: `postgres16`
3. Type: DB parameter group
4. Name: `loadlead-analytics-pg16`
5. After creation, **edit** the parameter group:
   - `shared_preload_libraries` → `pg_cron,pg_partman_bgw`
   - `cron.database_name` → `loadlead_analytics`
6. Save changes
7. RDS → your DB → **Modify** → Additional configuration → Parameter group
   → select `loadlead-analytics-pg16` → continue → **Apply immediately**
8. **Reboot** the DB instance for the parameter changes to take effect
   (RDS → your DB → Actions → Reboot)

**Then create the extensions:**

After reboot, connect via psql (using a bastion EC2 inside the VPC, or
RDS Query Editor via Session Manager) and run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_partman;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Sanity:
SELECT postgis_full_version();
SELECT extname FROM pg_extension WHERE extname IN ('postgis','pg_partman','pg_cron');
```

Confirm all three show up. Hand me the output of those `SELECT`s.

---

### Tier 1 deliverable checklist

When all of these are done, message me with:

- [ ] RDS endpoint URL (just the hostname is fine; I'll get the secret separately)
- [ ] Confirmation that the secret `loadlead/analytics/db` exists with
      `ANALYTICS_DATABASE_URL` populated
- [ ] IAM role ARN: `arn:aws:iam::…:role/loadlead-analytics-stream-consumer-role`
- [ ] The 8 DynamoDB stream ARNs (one per table)
- [ ] Output of the `SELECT postgis_full_version();` query confirming PostGIS is live

Once received, I'll build:
- `analytics.*` schema migrations (read models, partitioned event tables, MVs, indexes)
- Stream consumer Lambda (idempotent upsert keyed by `src_version`, per spec §3)
- One-time backfill script for existing DynamoDB rows
- Wire the OO + Carrier dashboard endpoints to read MVs instead of recomputing

---

## TIER 2 — Telematics (Gated on provider)

Until one of these is connected, **every telematics-derived field renders
"Connect <X>"**, never zeros (spec §0 no-fabrication rule).

Pick **one provider per category** and supply the credentials below.

### 2.1 ELD / HOS / Vehicle GPS (highest priority for OO + Carrier dashboards)

Drives: HOS warnings, vehicle position, ignition status, idle time,
hard-brake events, live ETA.

| Provider | Notes | Public docs |
|---|---|---|
| **Motive** (formerly KeepTruckin) | OAuth2; webhooks for real-time HOS + position | https://developer.gomotive.com/ |
| **Samsara** | Bearer token; webhook signing secret; one of the cleanest APIs | https://developer.samsara.com/docs |
| **Geotab** | Username + password + database name (MyGeotab API); older but very capable | https://developers.geotab.com/myGeotab/apiReference/ |
| **Verizon Connect** | OAuth2; certificate-based auth on enterprise plans | https://developer.verizonconnect.com/ |
| **Omnitracs** (Solera) | OAuth2; legacy SOAP option | https://developer.omnitracs.com/ |
| **Azuga** | API key | https://www.azuga.com/developers (request access) |
| **Lytx** | OAuth2; primarily safety-camera focused | https://developer.lytx.com/ |

**Once a provider is chosen, hand me:**

- API base URL (sandbox + production — keep them separate per LL-TP-001)
- Auth credentials (OAuth client_id/client_secret, or API key/bearer token)
- Webhook signing secret (for HMAC verification — LL-CR-004)
- The scope your account has subscribed to (HOS only? + GPS? + diagnostics?)
- Whether the provider is currently in **sandbox or live** for your account

I'll add the integration adapter under `backend/src/services/integrations/eld.ts`,
wire the `hosRemaining`, `hosWarnings`, and live position fields, and flip those
dashboard fields from `{available: false}` to live data.

---

### 2.2 Reefer telemetry (refrigerated-trailer temperature)

Drives: reefer deviation alerts, temperature compliance for cold-chain loads.

| Provider | Notes |
|---|---|
| **Carrier Lynx** (Carrier Transicold) | Most common on Carrier-brand reefer units |
| **Thermo King TracKing** | OEM telemetry for Thermo King reefers |
| **ORBCOMM** | Multi-OEM aggregator; works across reefer brands |
| **Skybitz** | Asset-tracking-focused; reefer temp is one sensor among many |

**Hand me:**

- API URL · API key
- Device serial / asset ID registration method (so we know which trailer the
  telemetry belongs to)
- Sensor IDs per trailer (multi-sensor reefer units expose temperature per
  compartment)

---

### 2.3 Fuel cards (for fuel-spend + tolls in the financial panel)

| Provider | Notes |
|---|---|
| **Comdata** | OAuth2; transaction webhooks |
| **EFS** | API key; bulk transaction pulls |
| **WEX** | OAuth2; granular per-driver, per-vehicle reporting |
| **RTS Fuel Card** | Transportation-focused; provides discount + reporting |

**Hand me:**

- API URL · client_id/secret (or API key)
- Merchant code (your fleet's identifier with the provider)
- Webhook secret for transaction events
- Whether you want **discount-network pricing** surfaced (some providers
  charge per-pull for the discounted-rate lookup)

---

### 2.4 FMCSA SMS / CSA scores (no provider — public dataset)

Drives: `csaScores` field in the carrier SLA panel.

- **No credential needed.** Public CSV dataset published by FMCSA.
- Just say "yes, ingest CSA" and I'll add a scheduled job that pulls the
  monthly CSV, filters to your DOT numbers, and exposes the scores on the
  dashboard.
- Rate-limited but free.
- Source: https://ai.fmcsa.dot.gov/SMS/Tools/Downloads.aspx

---

## Cost summary

| Tier | Monthly | One-time setup |
|---|---|---|
| Tier 1 — Geospatial (build-now) | ~$25–40 (db.t4g.small + 50 GB + Lambda invocations) | ~45 min in AWS console |
| Tier 2 — ELD provider | varies; ~$30–50 per truck per month from most providers | provider-specific onboarding (1–2 weeks for some) |
| Tier 2 — Reefer | varies; some are included in trailer purchase, others ~$10/month per unit | hardware registration |
| Tier 2 — Fuel card | usually $0 monthly (provider makes margin on transactions) | underwriting + card issuance (~1 week) |
| Tier 2 — FMCSA CSA | $0 | none |

---

## Anti-pattern reminders (don't break these)

- ❌ **Never** put `ANALYTICS_DATABASE_URL` in a `.env` file in the repo. Always
      Secrets Manager + IAM-scoped access.
- ❌ **Never** grant the stream consumer Lambda write permissions to DynamoDB.
      DynamoDB is read-only from the analytics replica's perspective (spec §6).
- ❌ **Never** fabricate data for an unconnected integration. If reefer isn't
      connected, the reefer field stays `{available: false, reason: 'integration_not_connected'}`
      and renders "Connect Reefer".
- ❌ **Never** try to install TimescaleDB on RDS. Spec §0: it's not on the
      allow-list. Use `pg_partman` + `pg_cron` instead.
- ✅ **Always** pin the stream consumer to one provider per integration (LL-TP-001).
      Don't fan out across multiple ELD vendors simultaneously — that's a
      reliability and cost trap.

---

## Hand-off

When Tier 1 (or any subset) is ready, message me:
> "Analytics tier 1 ready. Stream ARNs and secret name attached."

I'll start writing the schema migrations + stream consumer immediately. The
build-now tier ships independently of the telematics work — you can decide on
ELD providers without blocking the geospatial rollout.
