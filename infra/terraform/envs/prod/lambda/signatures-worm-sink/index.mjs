// signatures-worm-sink — DDB Streams → S3 Object Lock WORM sink.
//
// Consumes inserts from LoadLead_Signatures and writes one immutable
// JSON object per signature into the WORM bucket. The bucket has Object
// Lock COMPLIANCE on so even an account-root user cannot delete or
// shorten the retention of the object before the retention date.
//
// Append-only semantics: LoadLead_Signatures itself uses
// attribute_not_exists ConditionExpression on PutItem and IAM-Deny on
// UpdateItem/DeleteItem; this sink is a second copy in a different
// physical medium (S3) under a stronger lock (Object Lock COMPLIANCE
// vs IAM Deny on a bucket policy). Two-layer immutability:
//   layer 1: append-only DDB table  (this is the original record)
//   layer 2: WORM S3 object         (this is the audit-proof second copy)
//
// Stream view type is NEW_IMAGE so we ship every successful PutItem
// row in full. MODIFY/REMOVE events should never fire on this table —
// IAM denies them. If one ever does, this Lambda flags it as an
// integrity event and writes it under a /alerts/ prefix for ops.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const s3 = new S3Client({});

const BUCKET = process.env.WORM_BUCKET;
const RETAIN_DAYS = Number(process.env.RETAIN_DAYS || 2555); // 7 years default

if (!BUCKET) {
  // Surface mis-configuration immediately rather than dropping records.
  throw new Error("WORM_BUCKET env var not set");
}

function retainUntil() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + RETAIN_DAYS);
  return d;
}

export const handler = async (event) => {
  const results = [];

  for (const record of event.Records || []) {
    const eventName = record.eventName; // INSERT | MODIFY | REMOVE
    const image = record.dynamodb?.NewImage;

    // MODIFY/REMOVE on Signatures = integrity violation. Write under
    // /alerts/ with a timestamp so ops can find it.
    if (eventName !== "INSERT") {
      const key = `alerts/integrity/${eventName}/${record.dynamodb?.SequenceNumber}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key:    key,
        Body:   JSON.stringify({
          message: "Integrity event: non-INSERT mutation seen on LoadLead_Signatures",
          eventName,
          dynamodb: record.dynamodb,
        }, null, 2),
        ContentType: "application/json",
        // Apply Object Lock to the alert too — these records are
        // also legal evidence of an integrity breach.
        ObjectLockMode:            "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntil(),
      }));
      results.push({ key, eventName, alert: true });
      continue;
    }

    if (!image) continue;
    const sig = unmarshall(image);

    // Path is loadId/signatureId.json so signatures sort under the load
    // they belong to. signatureId is server-generated and unique, so no
    // overwrites under normal operation; Object Lock would block them
    // anyway.
    const loadId      = sig.loadId      || "unknown-load";
    const signatureId = sig.signatureId || "unknown-sig";
    const key = `loads/${loadId}/${signatureId}.json`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key:    key,
      Body:   JSON.stringify(sig, null, 2),
      ContentType: "application/json",
      // COMPLIANCE mode: even an account-root user cannot shorten the
      // retention date or delete this object before retainUntil.
      ObjectLockMode:            "COMPLIANCE",
      ObjectLockRetainUntilDate: retainUntil(),
      Metadata: {
        "ll-action":       String(sig.action || ""),
        "ll-signer-role":  String(sig.signerRole || ""),
        "ll-document-hash": String(sig.documentHash || ""),
      },
    }));
    results.push({ key, eventName, action: sig.action });
  }

  return { batchItemFailures: [], processed: results };
};
