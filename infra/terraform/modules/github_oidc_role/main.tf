############################################################################
# One IAM role per environment, assumable ONLY by a GitHub Actions run that
# matches the given ref or GitHub Environment. This is the actual isolation
# boundary for CI/CD: a workflow run on the `dev` branch physically cannot
# obtain credentials scoped to staging or prod, regardless of what the
# workflow YAML says — the trust policy is enforced by AWS, not GitHub.
############################################################################

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        var.allowed_environment != null
        ? "repo:${var.github_repo}:environment:${var.allowed_environment}"
        : "repo:${var.github_repo}:ref:${var.allowed_ref}"
      ]
    }
  }
}

resource "aws_iam_role" "this" {
  name                 = "loadlead-${var.env}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600 # 1h — AWS minimum (validator rejects <3600). Deploys are quick;
  # actual STS session token TTL is set by the workflow's `role-duration-seconds`,
  # which can still be lower than max_session_duration.
  tags = var.tags
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_role_policy" "deploy" {
  name = "loadlead-${var.env}-deploy-permissions"
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EBDeployThisEnvOnly"
        Effect = "Allow"
        Action = [
          "elasticbeanstalk:CreateApplicationVersion",
          "elasticbeanstalk:UpdateEnvironment",
          "elasticbeanstalk:DescribeEnvironments",
          "elasticbeanstalk:DescribeEvents",
          "elasticbeanstalk:DescribeApplicationVersions",
        ]
        Resource = [
          "arn:aws:elasticbeanstalk:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:application/${var.eb_application_name}",
          "arn:aws:elasticbeanstalk:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:environment/${var.eb_application_name}/${var.eb_environment_name}",
          "arn:aws:elasticbeanstalk:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:applicationversion/${var.eb_application_name}/*",
        ]
      },
      {
        # The deploy action (no bucket passed) calls CreateStorageLocation to
        # find/create the shared elasticbeanstalk-<region>-<account> bucket.
        # This API does not support resource-level permissions, so it must be
        # granted on "*". It is idempotent and only ensures the standard EB
        # app-versions bucket exists - no other resource is affected.
        Sid      = "EBCreateStorageLocation"
        Effect   = "Allow"
        Action   = ["elasticbeanstalk:CreateStorageLocation"]
        Resource = "*"
      },
      {
        # EB needs the deploy bundle staged in its auto-created S3 bucket.
        # Object-level for the upload; bucket-level so the action can locate
        # the bucket (HeadBucket/GetBucketLocation) and list existing versions.
        # EB stages the bundle AND, during the environment update, copies it
        # into resources/environments/<env-id>/_runtime/_versions/... setting
        # and clearing ACLs. So the full object op set (Put/Get/GetObjectAcl/
        # PutObjectAcl/DeleteObject) is needed, scoped to the EB bucket only.
        Sid      = "EBSourceBundleUpload"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectAcl", "s3:PutObjectAcl", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::elasticbeanstalk-${data.aws_region.current.name}-${data.aws_caller_identity.current.account_id}/*"
      },
      {
        # EB runs the environment update partly under the CALLER's identity and
        # surfaces read describes across the env's infra (ASG/EC2/ELB/CloudWatch
        # /SNS/logs). These Describe*/List* actions do NOT support resource-level
        # scoping, so they are granted on "*". Read-only: no mutation. The
        # mutating actions stay scoped to this env's EB app/environment, the EB
        # S3 bucket, and the awseb-* CloudFormation stacks above.
        Sid    = "EBDeployInfraDescribe"
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeScalingActivities",
          "autoscaling:DescribeLaunchConfigurations",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeNotificationConfigurations",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
          "ec2:DescribeImages",
          "ec2:DescribeKeyPairs",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeAccountAttributes",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:DescribeInstanceHealth",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:GetMetricStatistics",
          "sns:ListTopics",
          "sns:GetTopicAttributes",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      },
      {
        # During a deploy EB suspends the ASG's scaling processes (and resumes
        # them after) and may resize it. Scoped to EB-managed ASGs only
        # (autoScalingGroupName/awseb-*).
        Sid    = "EBAutoScalingManage"
        Effect = "Allow"
        Action = [
          "autoscaling:SuspendProcesses",
          "autoscaling:ResumeProcesses",
          "autoscaling:UpdateAutoScalingGroup",
        ]
        Resource = "arn:aws:autoscaling:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:autoScalingGroup:*:autoScalingGroupName/awseb-*"
      },
      {
        # GetBucketPolicy: EB reads the app-versions bucket policy during the
        # environment update. Bucket-level, scoped to the EB bucket only.
        Sid      = "EBSourceBundleBucketLocate"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy"]
        Resource = "arn:aws:s3:::elasticbeanstalk-${data.aws_region.current.name}-${data.aws_caller_identity.current.account_id}"
      },
      {
        # An EB environment is CloudFormation-backed (awseb-* stacks).
        # UpdateEnvironment makes the deploying principal read the env's
        # template/stack; without these it fails
        # InsufficientPrivilegesException on cloudformation:GetTemplate.
        # Scoped to EB-managed stacks only (read-only; EB's own service role
        # performs the actual stack mutation).
        Sid    = "EBManagedStackRead"
        Effect = "Allow"
        Action = [
          "cloudformation:GetTemplate",
          "cloudformation:GetTemplateSummary",
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackResource",
          "cloudformation:DescribeStackResources",
          "cloudformation:ListStackResources",
        ]
        Resource = "arn:aws:cloudformation:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stack/awseb-*/*"
      },
      {
        Sid      = "FrontendBucketSyncThisEnvOnly"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.frontend_bucket_arn, "${var.frontend_bucket_arn}/*"]
      },
      {
        Sid      = "FrontendInvalidateThisDistributionOnly"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = var.frontend_distribution_arn
      },
      {
        Sid      = "DescribeOnlyThisEnvTables"
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeTable", "dynamodb:ListTables"]
        Resource = ["arn:aws:dynamodb:*:*:table/${var.dynamodb_table_prefix}*"]
      },
    ]
  })
}

output "role_arn" {
  value = aws_iam_role.this.arn
}
