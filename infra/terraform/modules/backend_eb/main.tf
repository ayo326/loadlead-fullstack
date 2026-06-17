############################################################################
# One Elastic Beanstalk Environment per env, under the shared Application
# created in _bootstrap. Mirrors prod's platform (Node 22 / AL2023) so a
# behavior difference between staging and prod is never "different platform."
############################################################################

resource "aws_iam_role" "eb_instance_role" {
  name = "loadlead-${var.env}-eb-instance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "eb_web_tier" {
  role       = aws_iam_role.eb_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier"
}

# App-specific data access, scoped to THIS environment's resources only via
# the Environment tag/name prefix — a dev instance role cannot touch staging
# or prod DynamoDB tables or the prod S3 buckets.
resource "aws_iam_role_policy" "app_data_access" {
  name = "loadlead-${var.env}-app-data-access"
  role = aws_iam_role.eb_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoDBEnvScoped"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
                    "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"]
        Resource = [
          "arn:aws:dynamodb:*:*:table/${var.dynamodb_table_prefix}*",
          "arn:aws:dynamodb:*:*:table/${var.dynamodb_table_prefix}*/index/*",
        ]
      },
      {
        Sid      = "S3PodUploadsEnvScoped"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["arn:aws:s3:::loadlead-${var.env}-pod-uploads/*"]
      },
      {
        Sid      = "SESSend"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "eb" {
  name = "loadlead-${var.env}-eb-instance-profile"
  role = aws_iam_role.eb_instance_role.name
}

locals {
  base_settings = [
    { namespace = "aws:autoscaling:launchconfiguration", name = "InstanceType",      value = var.instance_type },
    { namespace = "aws:autoscaling:launchconfiguration", name = "IamInstanceProfile", value = aws_iam_instance_profile.eb.name },
    { namespace = "aws:autoscaling:launchconfiguration", name = "SecurityGroups",     value = var.security_group_id },
    { namespace = "aws:autoscaling:asg",                 name = "MinSize",            value = tostring(var.min_instances) },
    { namespace = "aws:autoscaling:asg",                 name = "MaxSize",            value = tostring(var.max_instances) },
    { namespace = "aws:ec2:vpc",                         name = "VPCId",              value = var.vpc_id },
    { namespace = "aws:ec2:vpc",                         name = "Subnets",            value = join(",", var.subnet_ids) },
    { namespace = "aws:ec2:vpc",                         name = "ELBSubnets",         value = join(",", var.elb_subnet_ids) },
    { namespace = "aws:ec2:vpc",                         name = "AssociatePublicIpAddress", value = "true" },
    { namespace = "aws:elasticbeanstalk:environment",    name = "EnvironmentType",    value = var.environment_type },
    { namespace = "aws:elasticbeanstalk:healthreporting:system", name = "SystemType", value = "enhanced" },
  ]

  env_var_settings = [
    for k, v in var.env_vars : {
      namespace = "aws:elasticbeanstalk:application:environment"
      name      = k
      value     = v
    }
  ]
}

resource "aws_elastic_beanstalk_environment" "this" {
  name                = "loadlead-backend-${var.env}"
  application         = var.application_name
  solution_stack_name = var.solution_stack_name
  tier                = "WebServer"

  dynamic "setting" {
    for_each = local.base_settings
    content {
      namespace = setting.value.namespace
      name      = setting.value.name
      value     = setting.value.value
    }
  }

  dynamic "setting" {
    for_each = local.env_var_settings
    content {
      namespace = setting.value.namespace
      name      = setting.value.name
      value     = setting.value.value
    }
  }

  tags = merge(var.tags, { Name = "loadlead-backend-${var.env}", Environment = var.env })
}
