# LoadLead reference taxonomies

Versioned reference data. The repo is the source of truth — the API serves
these files read-only, and the matching engine reads the same canonical lists.
No app writes ever land here; updates come via PR.

## Files

| File | Purpose |
|---|---|
| `equipment-classes.json` | The matching unit. Loads require a class; carriers/drivers list classes they operate. Attributes are the bridge to load characteristics (§3 in the spec). |
| `equipment-models.json`  | Manufacturer/model catalog. Asset metadata only — matching never reads it. Power units, trailers (keyed by class code), box trucks, refrigeration units. |
| `load-modes.json`        | FTL / LTL / Partial / Volume LTL. Mutually exclusive. |
| `service-types.json`     | Standard / Expedited / Hot Shot / Drayage / Final Mile / White Glove. Single-select. |
| `commodities.json`       | What's being hauled. ~100 commodities grouped into 12 categories; some carry `requires` hints (e.g., produce → temperature_required). Server-side `q=` search. |
| `accessorials.json`      | Detention / Lumper / Tarping / Liftgate / etc. Multi-select. |
| `hazmat-classes.json`    | DOT hazard classes 1–9 + endorsement hints (49 CFR §172.101). |

## Versioning

Every file carries `version` and `lastReviewed`. Bumping `version` is required
when removing a code or changing the meaning of one. Adding new entries can be
done without a version bump.

## Reconciliation TODOs

- Equipment class codes are aligned with DAT/Truckstop conventions where
  publicly documented. Before any external load-board integration, walk the
  list once against DAT's current published equipment list and tag the
  `_codeVerifiedAgainst` field.
- Commodity list will grow toward 500+ as we integrate with load boards;
  current ~100 covers the categories we expect to see in early traffic.
