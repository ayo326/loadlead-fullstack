// Defense in depth, layer 3 (after IAM Deny + attribute_not_exists Put):
// services/attestation/* MUST NOT import any DDB command that can mutate
// or delete a Signature row. The ban is enforced at authoring time so a
// drive-by edit can't sneak an UpdateCommand against LoadLead_Signatures
// past code review.
//
// podPhotoService.ts is allowed to use UpdateCommand because the photos
// table is NOT append-only — it's the synchronous-finalize transition
// store. Signatures-only files (signatureService.ts, etc.) are banned.

module.exports = {
  overrides: [
    {
      files: ['signatureService.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          paths: [
            {
              name: '@aws-sdk/lib-dynamodb',
              importNames: ['UpdateCommand', 'DeleteCommand', 'BatchWriteCommand'],
              message:
                'LoadLead_Signatures is append-only. UpdateItem / DeleteItem / ' +
                'BatchWriteItem are denied at the IAM layer and not allowed in ' +
                'signatureService.ts. Corrections must be NEW rows via ' +
                'recordSignature({ correctsSignatureId, ... }).',
            },
            {
              name: '@aws-sdk/client-dynamodb',
              importNames: ['UpdateItemCommand', 'DeleteItemCommand', 'BatchWriteItemCommand'],
              message:
                'LoadLead_Signatures is append-only. See signatureService.ts header.',
            },
          ],
        }],
      },
    },
  ],
};
