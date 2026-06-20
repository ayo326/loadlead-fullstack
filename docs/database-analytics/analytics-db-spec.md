---
connie-title: Database & Analytics — PostGIS Analytics DB Spec
connie-publish: true
---

# LoadLead — Analytics Database Build Spec (PostGIS, DynamoDB-fed)

_DynamoDB remains the source of truth. This is a separate Postgres + PostGIS analytics replica fed by DynamoDB Streams, for geospatial and aggregate analytics DynamoDB cannot do. No transactional migration. Scoped to the build-now tier; telematics is defined but gated._

## 0. Engine reality (read first)

- **PostGIS: supported on RDS** — use it for all geospatial.
- **TimescaleDB: NOT available on AWS RDS** (`CREATE EXTENSION timescaledb` fails). For time-series, use **native Postgres partitioning + pg_partman + pg_cron** (all supported on RDS). If a heavier time-series engine is ever needed for telematics, that is a separate decision (Timescale Cloud or Amazon Timestream), made when a provider connects.
- The build-now tier needs only PostGIS + materialized views, so it does NOT depend on any time-series engine.

## 1. Architecture

```
DynamoDB (source of truth, unchanged)
   └─ DynamoDB Streams (Loads, Offers, Drivers, OwnerOperators,
        Organizations, Memberships, Verifications, FactoringOptIns)
        └─ stream consumer (Lambda or EB worker, idempotent upsert)
             └─ Postgres analytics DB (RDS + PostGIS)
                  ├─ read models (denormalized projections)
                  ├─ native-partitioned event tables (status, telematics[gated])
                  └─ materialized views (dashboard aggregates, pg_cron refresh)
                       └─ dashboard / analytics endpoints read here
```

The analytics DB is **derived and read-only** from the app's perspective: only the stream consumer writes it. It is eventually consistent (stream lag of seconds); dashboards tolerate that.

## 2. Schema (`analytics` schema)

### 2.1 Read models (projected from DynamoDB)
- `loads(load_id PK, shipper_org_id, carrier_of_record_id, carrier_type, status, equipment, weight, commodity, origin geography(Point,4326), destination geography(Point,4326), origin_text, dest_text, pickup_window tstzrange, delivery_window tstzrange, rate_linehaul, rate_fuel, rate_total, route_miles, created_at, updated_at, src_version)`
- `offers(offer_id PK, load_id, driver_id, status, created_at, accepted_at)`
- `carriers(carrier_id PK, type CARRIER_ORG|OWNER_OPERATOR, name, base geography(Point,4326), equipment text[], verification_status, authority_active bool, verification_expires_at)`
- `drivers(driver_id PK, user_id, owned_by_operator_id, is_self bool, idv_status, equipment, cdl_class)`
- `verifications(entity_id PK, entity_type, fmcsa_active bool, kyb_status, idv_status, aml_status, verification_status, expires_at)`
- `factoring_optins(optin_id PK, load_id, status, created_at)`

Indexes: GiST on `loads.origin`, `loads.destination`, `carriers.base`; B-tree on `loads.status`, `loads.equipment`, `offers.load_id`, `verifications.verification_status`.

### 2.2 Event tables (native partitioned, pg_partman; NO TimescaleDB)
- `load_status_events(load_id, status, at timestamptz, location geography(Point,4326)) PARTITION BY RANGE (at)` — feeds dwell, detention, OTP. Fed from stream status transitions.
- `telematics_gps`, `telematics_hos`, `telematics_diag`, `reefer_temp` — **defined now, empty + ingestion disabled** until a telematics provider connects. Native partitioned by time; `telematics_gps` carries `position geography(Point,4326)`. These are the gated tier.

### 2.3 Aggregates (materialized views, refreshed by pg_cron)
- `mv_lane_volume` — load count by origin/dest cell + period
- `mv_rpm_by_lane` — avg `rate_linehaul / route_miles` by lane
- `mv_revenue` — gross by carrier + period
- `mv_acceptance` — accepted ÷ offered by carrier + period
- `mv_otp` — on-time pickup/delivery % from `load_status_events` vs windows
- `mv_onboarding` — verified / pending / blocked counts by carrier
- `mv_load_density`, `mv_carrier_density` — spatial bins for heatmaps

### 2.4 Geospatial query helpers (functions/views)
- carriers within radius of a load: `ST_DWithin(carriers.base, :origin, :radius_m)` on the GiST index
- deadhead: `ST_Distance(last_drop, next_pickup)` per truck/region
- lane length for RPM: `ST_Length(line)` or `route_miles`

## 3. Stream consumer
- Enable DynamoDB Streams (NEW_AND_OLD_IMAGES) on the listed tables.
- Consumer (Lambda preferred; EB worker acceptable) maps each change → idempotent UPSERT into the matching read model; derives `geography` from lat/lng; denormalizes carrier-of-record onto `loads`.
- Idempotency: upsert on PK, apply only if the event's version/updated_at is newer than the stored `src_version` (handles replays and out-of-order).
- Status transitions also append a row to `load_status_events`.

## 4. Backfill & refresh
- One-time backfill: scan each DynamoDB table → populate read models, then Streams keep them current. Idempotent + resumable + a row-count report.
- pg_cron refreshes the materialized views (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) on a cadence (5–15 min); OTP/dwell derive from `load_status_events` incrementally.

## 5. Build-now scope vs gated
- **Build now (no telematics):** read models + PostGIS geospatial-from-load (lane volume, radius matching, deadhead from load points, lane RPM, density) + the aggregate MVs + dwell/OTP from `load_status_events`.
- **Gated on a telematics provider:** the `telematics_*` / `reefer_temp` tables stay empty and their ingestion disabled; any dashboard tile sourced from them renders "not connected," never fabricated. Live-position geospatial (live ETA, real-time heatmaps) waits on the same provider.

## 6. Guardrails
- DynamoDB is source of truth; the analytics DB is write-only by the stream consumer. The app never writes it directly.
- No TimescaleDB on RDS. PostGIS + native partitioning (pg_partman/pg_cron) only.
- Telematics tables exist but stay empty + ingestion off until a provider connects; never fabricate telematics/geo-position data.
- Idempotent, version-guarded stream consumption.
- Analytics `DATABASE_URL` in env/secret; RDS provisioning by the operator/IaC, not application code.
- The build-now tier ships independently of any telematics work.
