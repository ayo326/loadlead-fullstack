---
connie-title: Architecture — Equipment & Load Type Taxonomy Build Spec
connie-publish: true
connie-page-id: '2260996'
---

# LoadLead — Equipment & Load Type Taxonomy Build Spec

_Implements two reference taxonomies (equipment, load types) as canonical reference data, exposes them via a reference API, drives all selection UI through a searchable dropdown, and wires them into load creation, carrier/driver capabilities, onboarding, and matching. Seed sources: the equipment taxonomy and the freight load-types taxonomy docs (place under /docs and /data/taxonomy)._

## 0. Scope & approach
- Build **both** equipment layers now: the matching layer (classes + attributes) and the manufacturer/model catalog.
- Add the **load-types taxonomy**, modeled as orthogonal dimensions (not a flat enum).
- All taxonomy selection in the UI uses a **searchable dropdown** (typeahead combobox), never free text.
- Reference data lives as **versioned JSON in the repo** (`/data/taxonomy/*.json`), served read-only via `/api/reference/*`. It is small, stable, read-mostly, so no DynamoDB dependency is required; the matching engine reads the same canonical lists.

## 1. Equipment taxonomy

### 1.1 Layer 1 — equipment class (the matching unit) + attributes
Both load requirements and carrier/driver capabilities reference this one list. Attributes: `temperature_controlled`, `hazmat_capable`, `food_grade`, `liftgate`, `oversize_capable`, `team_driver_required`, `length_ft`. `opt` = configurable per unit. Distinguish **articulated** (tractor + trailer; the trailer type is the matching unit) from **straight** (box/step van; the truck is the class). Align `code` with DAT/Truckstop conventions where possible (verify against their published equipment list).

| Class | Code | temp | hazmat | food_grade | oversize | type |
|---|---|---|---|---|---|---|
| Dry Van | V | N | opt | N | N | articulated |
| Reefer | R | Y | opt | opt | N | articulated |
| Flatbed | F | N | opt | N | Y | articulated |
| Step Deck | SD | N | opt | N | Y | articulated |
| Double Drop / Lowboy (RGN) | RGN | N | N | N | Y | articulated |
| Conestoga | CN | N | opt | N | Y | articulated |
| Fuel Tanker | TF | N | Y | N | N | articulated |
| Chemical Tanker | TC | N | Y | N | N | articulated |
| Food Grade Tanker | TFG | N | opt | Y | N | articulated |
| Hopper Bottom | HB | N | N | opt | N | articulated |
| Pneumatic Tank | PN | N | opt | N | N | articulated |
| Car Hauler | CH | N | N | N | N | articulated |
| Intermodal Chassis | CHS | N | opt | N | N | articulated |
| Power Only | PO | n/a | n/a | n/a | n/a | tractor only |
| Box Truck 26' | BOX26 | opt | N | N | N | straight |
| Refrigerated Box | RBOX | Y | N | opt | N | straight |
| Step Van | STEPVAN | N | N | N | N | straight |
| Hot Shot (gooseneck) | HS | N | opt | N | opt | straight |

Seed the full class set (40 to 60) from the equipment taxonomy doc; the rows above are the canonical core.

### 1.2 Layer 2 — manufacturer / model catalog (asset metadata, not a matching key)
Carrier asset records reference this for profile completeness and validation; matching never reads it. Structure: `class_code -> manufacturer -> model`. Seed power units (Freightliner Cascadia, Kenworth T680, ...), trailers (Great Dane Everest, Utility 3000R, ...), box trucks (Isuzu NPR, Freightliner M2, ...), and refrigeration units (Thermo King, Carrier Transicold) from the doc (150 to 250 combos).

## 2. Load-type taxonomy (orthogonal dimensions, not one enum)

| Dimension | Values | Notes |
|---|---|---|
| `mode` | FTL, LTL, Partial, Volume LTL | mutually exclusive (how much of the truck) |
| `service_type` | Standard, Expedited, Hot Shot, Drayage, Final Mile, White Glove | the service level |
| `characteristics` (combinable flags) | temperature_required (+ `min_temp`, `max_temp`, `temperature_mode`: Ambient/Chilled/Frozen/Multi-Temp), hazmat (+ `hazmat_class` 1-9), food_grade_required, bulk, oversized, heavy_haul, intermodal | can co-occur; these MIRROR equipment attributes |
| `commodity` | category + type (dry goods, building materials, automotive, agricultural, energy, industrial, ...) | searchable list, expandable to 500+ |
| `equipment_required` | references an equipment **class code** from 1.1 | the join to the equipment taxonomy |
| operational | `load_status` (Tendered/Accepted/Dispatched/In Transit/Delivered/POD Received/Invoiced), `pickup_type` (Live Load/Drop Trailer/Preloaded), `delivery_type` (Live Unload/Drop Trailer), `accessorials[]` (Detention, Layover, Lumper, Tarping, Escort, Liftgate, Residential), `trailer_utilization` (Full/Partial/Shared), `team_driver_required`, `twic_required` | |

## 3. The integration (why the decomposition matters)
Load characteristic **requirements** are the same dimensions as equipment **attributes**, opposite sides:

```
match(load, equipment) =
   equipment.class compatible with load.equipment_required
   AND for each required characteristic on the load,
       the assigned equipment provides it:
         temperature_required  -> temperature_controlled
         hazmat                -> hazmat_capable
         food_grade_required   -> food_grade
         oversized/heavy_haul  -> oversize_capable
   AND driver endorsements satisfy load (hazmat endorsement, TWIC, team)
```

This is exactly what **broadcast eligibility** and the dashboard **equipment-match guardrail** (no flatbed on a reefer load) evaluate. Keep the rule in one shared, persona-neutral service.

## 4. Reference data + API
- Versioned JSON under `/data/taxonomy/`: `equipment-classes.json`, `equipment-models.json`, `load-modes.json`, `service-types.json`, `commodities.json`, `accessorials.json`, `hazmat-classes.json`.
- Read-only endpoints: `GET /api/reference/equipment-classes`, `/equipment-models?class=`, `/load-modes`, `/service-types`, `/commodities?q=`, `/accessorials`, `/hazmat-classes`. Support `q=` server-side search for the large lists (models, commodities).

## 5. UI — searchable dropdowns (explicit requirement)
- One reusable **searchable combobox** primitive (typeahead): filter-as-you-type, grouped by category, keyboard accessible, fed from `/api/reference/*`. Persona-neutral shared atom (used by both Carrier and OO independently).
- **Async** search for large lists (equipment models, commodities); **multi-select** for accessorials and characteristic flags; single-select for class, mode, service type.
- No free-text entry for equipment class, model, load mode, service type, commodity, or accessorials. Free text is allowed only for genuinely freeform notes.
- Used in: load creation, carrier/OO/driver capability and equipment setup, onboarding.

## 6. Where it is used
Load creation form (equipment_required + mode + service + characteristics + commodity + accessorials), carrier/OO/driver capability and equipment (class + attributes + optional model catalog), onboarding (equipment + endorsements), matching/broadcast eligibility (the §3 rule), and the dashboard equipment-match guardrail.

## 7. Notes
- Reference data is one-way from the repo; updates land via PR and flow to the API and dropdowns. This also feeds the docs-to-Confluence pipeline.
- Code values should be reconciled with DAT/Truckstop equipment conventions before any external load-board integration, to avoid a translation layer later.
