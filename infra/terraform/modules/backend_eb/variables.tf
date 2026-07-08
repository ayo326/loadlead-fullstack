variable "env" {
  type = string
}

variable "application_name" {
  description = "Existing EB Application name, created once in _bootstrap"
  type        = string
  default     = "LoadLead-Backend"
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Public subnets for dev (no NAT); private subnets for staging/prod (behind NAT)"
  type        = list(string)
}

variable "elb_subnet_ids" {
  description = "Subnets for the load balancer — always public"
  type        = list(string)
}

variable "security_group_id" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "min_instances" {
  type    = number
  default = 1
}

variable "max_instances" {
  type    = number
  default = 1
}

variable "solution_stack_name" {
  description = "Match prod's platform exactly for environment parity. NOTE: AWS retires old point versions — keep this pinned to whatever prod currently runs (aws elasticbeanstalk describe-environments ... SolutionStackName)."
  type        = string
  default     = "64bit Amazon Linux 2023 v6.11.1 running Node.js 22"
}

variable "env_vars" {
  description = "Application environment variables (DynamoDB table names, DIDIT_* keys, JWT secret, etc.) — per-env values, not committed to git. Pass via -var-file=secrets.tfvars (gitignored) or a secrets manager."
  type        = map(string)
  sensitive   = true
}

variable "dynamodb_table_prefix" {
  description = "e.g. LoadLead-Dev- / LoadLead-Staging- — used only to scope the instance role's IAM policy resource ARNs"
  type        = string
}

variable "compliance_s3_enabled" {
  description = "Toggle the compliance-docs S3 grant on the instance role (s3:GetObject+s3:PutObject, scoped to compliance_s3_bucket_arn). Static bool — kept separate from the arn so `count` is knowable at plan time even when the bucket is created in the same apply."
  type        = bool
  default     = false
}

variable "compliance_s3_bucket_arn" {
  description = "ARN of this env's private carrier-compliance-documents S3 bucket (W9/COI/LOA objects). Granted s3:GetObject+s3:PutObject ONLY, and only when compliance_s3_enabled = true."
  type        = string
  default     = ""
}

variable "w9_tin_kms_enabled" {
  description = "Toggle the W9-TIN KMS grant on the instance role (kms:GenerateDataKey+kms:Decrypt, scoped to w9_tin_kms_key_arn). Static bool so `count` is knowable at plan time even when the key is created in the same apply. Leave false for envs that run field crypto in local-stub mode (dev)."
  type        = bool
  default     = false
}

variable "w9_tin_kms_key_arn" {
  description = "ARN of this env's dedicated W9-TIN KMS key. Granted kms:GenerateDataKey+kms:Decrypt ONLY (least privilege), and only when w9_tin_kms_enabled = true."
  type        = string
  default     = ""
}

variable "environment_type" {
  description = "SingleInstance (no ELB — cheapest, fine for dev/staging) or LoadBalanced (prod)"
  type        = string
  default     = "SingleInstance"
}

variable "enabled" {
  description = "When false, the EB environment (the only billable part) is torn down — the 'pause' switch. IAM role/profile persist (free), so resume just recreates the env. Set false for the $0 resting state."
  type        = bool
  default     = true
}

variable "cname_prefix" {
  description = "Deterministic CNAME prefix so the env resolves at a stable <prefix>.<region>.elasticbeanstalk.com across pause/resume. Defaults to the env name when empty."
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
