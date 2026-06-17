variable "env" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "domain_name" {
  description = "e.g. staging.loadleadapp.com. Null = no custom domain, use the CloudFront default domain (dev)."
  type        = string
  default     = null
}

variable "acm_certificate_arn" {
  description = "Must already exist in us-east-1. Required only if domain_name is set."
  type        = string
  default     = null
}

variable "price_class" {
  description = "PriceClass_100 (US/EU only) is enough for dev/staging and ~half the cost of All-edge-locations"
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  type    = map(string)
  default = {}
}
