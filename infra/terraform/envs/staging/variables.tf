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

variable "api_staging_domain" {
  description = "e.g. api-staging.loadleadapp.com — CloudFront TLS front for the SingleInstance backend"
  type        = string
  default     = "api-staging.loadleadapp.com"
}

variable "backend_enabled" {
  description = "Whether the EB env exists at all. Day-to-day pausing is done by the Start/Pause button (scales the env's instances to 0 = $0 compute, env stays put), so this defaults to true. Set false via `make staging-pause` only for a FULL teardown/decommission of the env (deeper than the button; ~5 min to rebuild)."
  type        = bool
  default     = true
}

variable "route53_zone_id" {
  description = "Hosted zone ID for loadleadapp.com"
  type        = string
}
