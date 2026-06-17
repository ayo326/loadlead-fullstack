variable "env" {
  type = string
}

variable "github_oidc_provider_arn" {
  type = string
}

variable "github_repo" {
  description = "owner/repo, e.g. ayo326/loadlead-fullstack"
  type        = string
}

variable "allowed_ref" {
  description = "GitHub Actions ref this role can be assumed from, e.g. refs/heads/dev, refs/heads/main, or refs/tags/v*. Use a GitHub Environment name instead via allowed_environment for prod's manual-approval gate."
  type        = string
  default     = null
}

variable "allowed_environment" {
  description = "GitHub Environment name (e.g. \"production\") — restricts AssumeRole to workflow runs targeting that Environment, which is what enforces the required-reviewers approval gate at the AWS-credential level, not just the GitHub UI level."
  type        = string
  default     = null
}

variable "dynamodb_table_prefix" {
  type = string
}

variable "eb_environment_name" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_distribution_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
