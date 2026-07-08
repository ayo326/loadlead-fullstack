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
        Sid    = "DynamoDBEnvScoped"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
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

# Carrier-compliance-documents S3 bucket (SCRUM-59). Scoped to THIS env's
# compliance bucket only — created as a separate policy (rather than folded into
# app_data_access) so it's gated on the arn being supplied, and so the grant
# is legible/auditable as its own least-privilege statement.
resource "aws_iam_role_policy" "compliance_docs_s3" {
  count = var.compliance_s3_enabled ? 1 : 0
  name  = "loadlead-${var.env}-compliance-docs-s3"
  role  = aws_iam_role.eb_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "S3ComplianceDocsObjectRW"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = ["${var.compliance_s3_bucket_arn}/*"]
    }]
  })
}

# W9-TIN envelope-encryption KMS key (SCRUM-59). GenerateDataKey + Decrypt on
# the ONE dedicated key only — this role can neither use any other key nor
# perform key administration. Fields other than the W9 TIN never touch KMS.
resource "aws_iam_role_policy" "w9_tin_kms" {
  count = var.w9_tin_kms_enabled ? 1 : 0
  name  = "loadlead-${var.env}-w9-tin-kms"
  role  = aws_iam_role.eb_instance_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "KmsW9TinEnvelopeCrypto"
      Effect   = "Allow"
      Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
      Resource = [var.w9_tin_kms_key_arn]
    }]
  })
}

resource "aws_iam_instance_profile" "eb" {
  name = "loadlead-${var.env}-eb-instance-profile"
  role = aws_iam_role.eb_instance_role.name
}

locals {
  base_settings = [
    { namespace = "aws:autoscaling:launchconfiguration", name = "InstanceType", value = var.instance_type },
    { namespace = "aws:autoscaling:launchconfiguration", name = "IamInstanceProfile", value = aws_iam_instance_profile.eb.name },
    { namespace = "aws:autoscaling:launchconfiguration", name = "SecurityGroups", value = var.security_group_id },
    { namespace = "aws:autoscaling:asg", name = "MinSize", value = tostring(var.min_instances) },
    { namespace = "aws:autoscaling:asg", name = "MaxSize", value = tostring(var.max_instances) },
    { namespace = "aws:ec2:vpc", name = "VPCId", value = var.vpc_id },
    { namespace = "aws:ec2:vpc", name = "Subnets", value = join(",", var.subnet_ids) },
    { namespace = "aws:ec2:vpc", name = "ELBSubnets", value = join(",", var.elb_subnet_ids) },
    { namespace = "aws:ec2:vpc", name = "AssociatePublicIpAddress", value = "true" },
    { namespace = "aws:elasticbeanstalk:environment", name = "EnvironmentType", value = var.environment_type },
    { namespace = "aws:elasticbeanstalk:healthreporting:system", name = "SystemType", value = "enhanced" },
  ]
}

resource "aws_elastic_beanstalk_environment" "this" {
  # count gates ONLY the billable environment. The IAM role/profile above are
  # free and stay put, so 'pause' (enabled=false) → $0 and 'resume' just
  # recreates the env in ~3-4 min against the same deterministic CNAME.
  count = var.enabled ? 1 : 0

  name                = "loadlead-backend-${var.env}"
  application         = var.application_name
  solution_stack_name = var.solution_stack_name
  tier                = "WebServer"
  cname_prefix        = var.cname_prefix == "" ? null : var.cname_prefix

  dynamic "setting" {
    # for_each needs a map/set, not a tuple — key each setting by namespace/name.
    for_each = { for s in local.base_settings : "${s.namespace}/${s.name}" => s }
    content {
      namespace = setting.value.namespace
      name      = setting.value.name
      value     = setting.value.value
    }
  }

  dynamic "setting" {
    # env_vars is sensitive, and for_each can't take a sensitive collection.
    # Drive the loop with the env var NAMES (not secret; nonsensitive() strips
    # the marking that keys() inherits), and look the secret VALUE up inside so
    # it keeps its sensitive marking and never lands in plan output.
    for_each = toset(nonsensitive(keys(var.env_vars)))
    content {
      namespace = "aws:elasticbeanstalk:application:environment"
      name      = setting.value
      value     = var.env_vars[setting.value]
    }
  }

  tags = merge(var.tags, { Name = "loadlead-backend-${var.env}", Environment = var.env })

  lifecycle {
    # The AWS provider doesn't read the EB environment's "Name" tag back into
    # state (EB exposes tags via a separate API the resource doesn't refresh
    # from), so every plan re-proposes adding a Name tag that is already live —
    # a benign perpetual diff. The tag is still SET on create (ignore_changes
    # doesn't affect creation); we just stop churning it on every subsequent
    # plan. Scoped to the single key so all other tag drift stays visible.
    ignore_changes = [tags["Name"], tags_all["Name"]]
  }
}
