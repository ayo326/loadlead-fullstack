---
connie-title: Dashboards - Carrier & Owner Operator Build Spec
connie-publish: true
connie-page-id: '164002'
---

# LoadLead - Carrier & Owner Operator Dashboard Build Spec

_Companion to LoadLead_Reference_Refactored.md. Defines the dashboards for the two carrier-parent types (Carrier org via CARRIER_ADMIN, and Owner Operator) plus a settings-parity requirement so OO settings mirror carrier settings._

## 0. Scope & rules

Feasibility legend for every variable below:
- ✅ build now from existing data (`Loads`, `Offers`, `Verifications`, `FactoringOptIns`, `Memberships`, Maps routing)
- 🟡 light data-capture add (status-transition timestamps, COI fields)
- 🔴 needs an integration LoadLead doesn't have (ELD/HOS, reefer telemetry, fuel cards, FMCSA SMS)

**No-fabrication rule (hard):** 🔴 variables are returned as `{ available: false, reason: 'integration_not_connected' }` and rendered as a "Connect <X>" placeholder. Never display zeros, mock values, or fake data for an unconnected integration - a dashboard that invents HOS hours or fuel spend is worse than one that says "not connected."

Both dashboards are computed **server-side** into one payload per request (no N+1 from the client).

---

## 1. Carrier dashboard (CARRIER_ADMIN, org-scoped)

`GET /api/org/:orgId/dashboard?range=week|month` → guarded by membership + `requireOrgCapability(CARRIER)`.

### 1.1 Alerts (firefighting strip)
| Field | Source | Tag |
|---|---|---|
| `activeLoads{booked,dispatched,inTransit,atPickup,delivered}` | counts by `Loads.status` for org | ✅ |
| `unassigned[]` | org-accepted loads with `assignedDriverId=null` | ✅ |
| `etaAtRisk[]{loadId,eta,window,minutesLate}` | `route.eta` (googleMapsService) vs `delivery.window` | 🟡 |
| `hosWarnings` | ELD | 🔴 |
| `reeferDeviations` | trailer telemetry | 🔴 |

### 1.2 Fleet & compliance
| Field | Source | Tag |
|---|---|---|
| `drivers[]{driverId,name,availability:free\|on-load,idvStatus}` | `Memberships` (ORG_DRIVER) + active `Offers`/`Loads` + `user.idvStatus` | ✅ |
| `onboarding{verified,pending,blocked}` | member drivers by `user.idvStatus` + org `Verifications.verificationStatus` | ✅ |
| `authorityExpiry[]{daysLeft}` | `Verifications[orgId].expiry` within 90d | ✅ |
| `insurance{onFile,expiresAt}` | COI fields | 🟡 (not captured today) |
| `hosRemaining`, `equipmentHealth` | ELD / telematics | 🔴 |

### 1.3 Financial
| Field | Source | Tag |
|---|---|---|
| `grossRevenue{week,month}` | `Σ Loads.rate.total` (org, delivered/in-flight) | ✅ |
| `rpm{avg,byLoad[]}` | `rate.linehaul / route.miles` | ✅ |
| `payeeBreakdown{carrier,factor}` | `resolveInvoicePayee` per delivered load | ✅ |
| `factoringPipeline{submitted,approved,funded}` | `FactoringOptIns.status` (submitted ✅; approved/funded need integrated-partner callbacks) | 🟡 |
| `fuelSpend`, `tolls` | fuel card API | 🔴 |

### 1.4 Load board & dispatch
| Field | Source | Tag |
|---|---|---|
| `tendered[]{origin,dest,weight,commodity,equipment,payout}` | broadcast `Offers` to org | ✅ |
| `capabilityWarnings[]` | refactor capability check + broadcast equipment/CDL eligibility | ✅ |
| `dwell[]{loadId,location,minutes}` | At-Pickup→Departed / At-Delivery→Departed status timestamps | 🟡 |
| `deadhead[]` | last-drop → next-pickup distance (Maps) | 🟡 |

### 1.5 SLA analytics
| Field | Source | Tag |
|---|---|---|
| `otp{pickupPct,deliveryPct}` | actual timestamps vs `window` | 🟡 (needs timestamps) |
| `acceptanceRate`,`rejectionRate` | `Offers` accepted ÷ offered | ✅ |
| `compliancePosture{authorityActive,verificationCurrent}` | `Verifications` rollup | ✅ |
| `csaScores` | FMCSA SMS dataset | 🔴 |

### 1.6 Role layouts
- **Dispatcher (CARRIER_ADMIN default):** map-heavy - alerts strip on top, active/unassigned loads + assignment, tendered board, driver availability, dwell. (Sections 1.1, 1.2, 1.4)
- **Exec view (toggle):** no map - financial tiles (gross, RPM, payee/factoring), OTP, acceptance rate, compliance posture, utilization. (Sections 1.3, 1.5)

---

## 2. Owner Operator dashboard (operator-scoped, blended)

`GET /api/owner-operator/dashboard?range=...`. An OO is dispatcher **and** driver, so the layout blends a personal-haul panel with the same fleet/finance/compliance panels as the carrier.

| Panel | Field | Source | Tag |
|---|---|---|---|
| My haul | `activeSelfLoad`, `selfStatus`, `selfEta` | load assigned to the OO self-driver (`isSelf`) | ✅ |
| Fleet | same as 1.2, scoped via `ownedByOperatorId`/`fleetDriverIds` (self-driver shown, non-removable) | ✅ |
| My verification | `authority` = `Verifications[operatorId]`; `identity` = OO `user.idvStatus`; `expiry` | ✅ |
| Finance | `grossRevenue`, `rpm`, `payeeBreakdown`, `factoringPipeline` (operator-scoped) | ✅ / 🟡 |
| Load board | `tendered` eligible for self **or** fleet; `acceptAs: self\|fleet` | ✅ |
| Alerts | active/unassigned/etaAtRisk (operator-scoped); HOS/reefer 🔴 | ✅ / 🟡 / 🔴 |

The same role toggle applies: a solo OO lives in the blended view; an OO with a fleet can switch to the exec/financial rollup.

---

## 3. Settings parity - OO mirrors Carrier

Define **one canonical set of carrier settings sections**. Both carrier-parent types render the same sections, each bound to its own entity. Parity is structural (a shared schema/component parameterized by parent type), not duplicated code - so a change to a section updates both and they can't drift.

| Section | Carrier org binds to | Owner Operator binds to |
|---|---|---|
| Profile | Organization(name) + carrier profile: MC/DOT, equipment, base + radius | OwnerOperator: name, MC/DOT, equipment, base + radius |
| Verification | `Verifications[orgId]` (FMCSA + KYB), expiry, re-verify | `Verifications[operatorId]`, expiry, re-verify |
| Identity | member drivers' `user.idvStatus` overview | self-driver + fleet drivers' `user.idvStatus` |
| Drivers / Fleet | `Memberships`: onboard (direct + invite), roster, remove | `fleetDriverIds`/`ownedByOperatorId`: invite, remove (self-driver non-removable) |
| Factoring | `CarrierFactoringProfiles[orgId]` via `/api/factoring/*` (BYO/integrated) | `CarrierFactoringProfiles[operatorId]` via the same `/api/factoring/*` |
| Notifications | push/email prefs | push/email prefs |
| Members & roles | org membership roles (OWNER/DISPATCHER/ORG_DRIVER) | N/A (OO is owner; fleet = drivers) - section hidden, not stubbed |
| Capabilities | CARRIER (read-only; exclusivity enforced) | CARRIER (inherent; read-only) |

Rules:
- A shared `<CarrierSettings parentType={CARRIER_ORG|OWNER_OPERATOR} />` (or equivalent) renders the section list; each section's data adapter resolves to the right record by parent type.
- System-owned fields (verification status, idvStatus, capabilities) are **read-only mirrors** with an action (re-verify, complete IDV) - never directly editable.
- No separate settings store: each section reads/writes the canonical record (OwnerOperator / Organization / Verification / FactoringProfile / Driver).
- A parity test asserts both parent types expose the same section set, minus the explicitly N/A ones.

---

## 4. Aggregation endpoints
| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/org/:orgId/dashboard` | membership + `requireOrgCapability(CARRIER)` | §1 payload |
| `GET /api/owner-operator/dashboard` | OO | §2 payload |
| `GET/PUT /api/org/:orgId/settings` | membership (OWNER/DISPATCHER) | §3 sections (carrier) |
| `GET/PUT /api/owner-operator/settings` | OO | §3 sections (OO) - same schema |

Each dashboard endpoint computes all panels in one handler; 🔴 fields return the `{available:false}` shape.

---

## 5. Build order
1. Backend aggregation endpoints (§4) returning ✅ fields + `{available:false}` for 🔴.
2. Carrier dispatcher view (1.1/1.2/1.4) + exec toggle (1.3/1.5).
3. OO blended dashboard (§2) reusing the same panel components, operator-scoped.
4. Shared carrier-settings component (§3) wired to both parent types; parity test.
5. 🟡 adds last: status-transition timestamps (unlocks dwell + OTP), COI fields, factoring approved/funded callbacks.
6. 🔴 lane: render "Connect ELD / fuel card / SMS" placeholders; do not fabricate.
