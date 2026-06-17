output "environment_name" {
  value = aws_elastic_beanstalk_environment.this.name
}

output "endpoint_url" {
  value = aws_elastic_beanstalk_environment.this.endpoint_url
}

output "cname" {
  value = aws_elastic_beanstalk_environment.this.cname
}

output "instance_role_arn" {
  value = aws_iam_role.eb_instance_role.arn
}
