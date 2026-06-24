###########################################################################
# IAM defense — append-only for LoadLead_Signatures.
#
# Layer 1 of the three-layer immutability story:
#   1) IAM Deny (this file) on UpdateItem/DeleteItem/BatchWriteItem,
#   2) App-layer attribute_not_exists(signatureId) on every PutItem,
#   3) ESLint rule banning UpdateCommand/DeleteCommand imports from
#      services/attestation/signatureService.ts.
#
# Even with this Deny, the app would benefit from #2 because some shared
# Allow elsewhere could grant PutItem broadly; attribute_not_exists turns
# every Put into a strict insert so a duplicate id collides and is rejected.
#
# Attach the resulting policy to the backend EB instance profile role.
###########################################################################

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = ">= 5.0" } }
}

variable "signatures_table_arn" {
  description = "ARN of the LoadLead_Signatures table to lock down."
  type        = string
}

variable "role_name" {
  description = "Name of the EB instance profile role to attach the policy to."
  type        = string
}

data "aws_iam_policy_document" "signatures_append_only" {
  statement {
    sid     = "SignaturesAllowAppendAndRead"
    effect  = "Allow"
    actions = [
      "dynamodb:PutItem",   # paired in code with ConditionExpression attribute_not_exists(signatureId)
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:DescribeTable",
    ]
    resources = [
      var.signatures_table_arn,
      "${var.signatures_table_arn}/index/*",
    ]
  }

  statement {
    sid     = "SignaturesNeverMutate"
    effect  = "Deny"
    actions = [
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      # BatchWriteItem carries deletes; not used for signatures.
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      var.signatures_table_arn,
      "${var.signatures_table_arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "signatures_append_only" {
  name        = "LoadLead-Signatures-AppendOnly"
  description = "Append-only access for LoadLead_Signatures; explicit Deny on UpdateItem/DeleteItem/BatchWriteItem."
  policy      = data.aws_iam_policy_document.signatures_append_only.json
}

resource "aws_iam_role_policy_attachment" "attach" {
  role       = var.role_name
  policy_arn = aws_iam_policy.signatures_append_only.arn
}

output "policy_arn" { value = aws_iam_policy.signatures_append_only.arn }
