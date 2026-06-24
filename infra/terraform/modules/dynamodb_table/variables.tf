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

variable "stream_enabled" {
  type        = bool
  default     = false
  description = "Enable DDB Streams. Required when downstream wants change events (e.g. WORM sink Lambda)."
}

variable "stream_view_type" {
  type        = string
  default     = "NEW_IMAGE"
  description = "What each stream record carries. NEW_IMAGE is right for append-only WORM mirrors; NEW_AND_OLD_IMAGES is right for diff/audit pipelines."
}

variable "tags" {
  type    = map(string)
  default = {}
}
