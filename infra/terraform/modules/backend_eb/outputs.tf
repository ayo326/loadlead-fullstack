# The env is count-gated (pause switch), so these read through a one_or_zero
# list. When paused (enabled=false) they return null — callers that need a
# stable name/CNAME across pause should use the deterministic value they pass
# in (var.cname_prefix), not these.
output "environment_name" {
  value = one(aws_elastic_beanstalk_environment.this[*].name)
}

output "endpoint_url" {
  value = one(aws_elastic_beanstalk_environment.this[*].endpoint_url)
}

output "cname" {
  value = one(aws_elastic_beanstalk_environment.this[*].cname)
}

output "instance_role_arn" {
  value = aws_iam_role.eb_instance_role.arn
}
