variable "env" {
  type = string
}

variable "prefix" {
  description = "e.g. LoadLead-Dev- / LoadLead-Staging-"
  type        = string
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
