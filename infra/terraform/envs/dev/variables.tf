variable "github_repo" {
  type    = string
  default = "ayo326/loadlead-fullstack"
}

variable "backend_env_vars" {
  description = "Plaintext app env vars for the EB environment. Pass via -var-file=secrets.auto.tfvars (gitignored) — never commit real values."
  type        = map(string)
  sensitive   = true
}

variable "dev_domain" {
  description = "Custom domain for the dev frontend."
  type        = string
  default     = "dev.loadleadapp.com"
}

variable "route53_zone_id" {
  description = "Hosted zone ID for loadleadapp.com"
  type        = string
  default     = "Z0629234HLIG8V94D0UI"
}
