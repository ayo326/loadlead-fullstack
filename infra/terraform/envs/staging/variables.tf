variable "github_repo" {
  type    = string
  default = "ayo326/loadlead-fullstack"
}

variable "backend_env_vars" {
  type      = map(string)
  sensitive = true
}

variable "staging_domain" {
  description = "e.g. staging.loadleadapp.com"
  type        = string
  default     = "staging.loadleadapp.com"
}

variable "route53_zone_id" {
  description = "Hosted zone ID for loadleadapp.com"
  type        = string
}
