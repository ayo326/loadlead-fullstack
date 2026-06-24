# Canonical Projection Changelog

The projection is the **exact set of fields** that flow into a signature's
`documentHash`. It is a legal artifact. Every change here must:

1. Increment `canonicalSchemaVersion` (do not edit v1 in place).
2. Keep the old projection compiled and available for verifying old signatures.
3. Include a brief rationale.

## v1 — initial (2026-06-24)

Per-action allowlist. Sorted keys, normalized types (numbers as JSON
numbers without trailing zeros; ISO-8601 dates with `Z` suffix). Photos
are referenced by `contentHash` of bytes; never by URL or S3 key.

- `BOL_SUBMIT`: loadId, bolId?, shipperOrgId?, shipperUserId, commodityDescription, totalWeightLbs, pickupAddress, pickupCity, pickupState, pickupZip, pickupLat, pickupLng, pickupDate, deliveryAddress, deliveryCity, deliveryState, deliveryZip, deliveryLat, deliveryLng, deliveryDate, equipmentType, acceptedEquipmentTypes[], minMcMaturityDays, minCargoInsurance, minLiabilityInsurance, hazmat, originPhotoContentHashes[]

- `CARRIER_ACCEPT`: loadId, carrierOfRecord.entityType, carrierOfRecord.entityId, assignedDriverId, rateAmount, rateType

- `DRIVER_PICKUP`: loadId, stage: "PICKUP", pickupActualAt, pickupGeo: { lat, lng } | null, photoContentHashes[] (sorted)

- `DRIVER_DELIVER`: loadId, stage: "DELIVERY", deliveredActualAt, deliveryGeo: { lat, lng } | null, photoContentHashes[] (sorted)

- `RECEIVER_CONFIRM`: loadId, stage: "RECEIPT", receivedActualAt, photoContentHashes[] (sorted), exceptions: { code, description } | null
