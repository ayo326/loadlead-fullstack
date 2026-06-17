variable "name" {
  description = "Full table name, already env-prefixed by the caller (e.g. LoadLead-Dev-Drivers)"
  type        = string
}

variable "hash_key" {
  type = string
}

variable "range_key" {
  type    = string
  default = null
}

variable "attributes" {
  description = "All attributes referenced by the hash/range key or any GSI. list({ name, type }) where type is S|N|B"
  type = list(object({
    name = string
    type = string
  }))
}

variable "global_secondary_indexes" {
  description = "list({ name, hash_key, range_key (optional), projection_type })"
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = optional(string)
    projection_type = optional(string, "ALL")
  }))
  default = []
}

variable "ttl_attribute" {
  type    = string
  default = null
}

variable "deletion_protection" {
  description = "Hard block on terraform destroy / console delete. Always true for prod."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
