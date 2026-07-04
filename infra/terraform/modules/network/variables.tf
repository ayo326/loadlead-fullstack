variable "env" {
  description = "dev | staging | prod"
  type        = string
}

variable "vpc_cidr" {
  type = string
}

variable "azs" {
  description = "Two AZs for the public/private subnet pairs"
  type        = list(string)
}

variable "enable_nat" {
  description = "Create a NAT Gateway for private-subnet egress. Skip in dev to save ~$32/mo + data charges — dev's single EB instance runs in a public subnet behind a locked-down SG instead."
  type        = bool
  default     = false
}

variable "allow_cloudfront_http" {
  description = "Open port 80 on the EB instance SG to CloudFront's origin-facing IP ranges (managed prefix list). Set true when a SingleInstance env is fronted by CloudFront for TLS instead of an ALB."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
