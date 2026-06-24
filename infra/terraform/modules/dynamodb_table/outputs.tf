output "name" {
  value = aws_dynamodb_table.this.name
}

output "arn" {
  value = aws_dynamodb_table.this.arn
}

output "stream_arn" {
  description = "Latest stream ARN; null when stream_enabled = false."
  value       = aws_dynamodb_table.this.stream_arn
}
