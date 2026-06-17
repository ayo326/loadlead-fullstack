variable "github_repo" {
  type    = string
  default = "ayo326/loadlead-fullstack"
}

variable "backend_env_vars" {
  description = "Plaintext app env vars for the EB environment. Pass via -var-file=secrets.auto.tfvars (gitignored) — never commit real values."
  type        = map(string)
  sensitive   = true
}
