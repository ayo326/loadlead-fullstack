output "table_names" {
  value = { for k, m in module.table : k => m.name }
}

output "table_arns" {
  value = { for k, m in module.table : k => m.arn }
}
