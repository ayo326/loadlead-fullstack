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
  description = "Match prod's platform exactly for environment parity"
  type        = string
  default     = "64bit Amazon Linux 2023 v6.5.1 running Node.js 22"
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

variable "environment_type" {
  description = "SingleInstance (no ELB — cheapest, fine for dev/staging) or LoadBalanced (prod)"
  type        = string
  default     = "SingleInstance"
}

variable "tags" {
  type    = map(string)
  default = {}
}
