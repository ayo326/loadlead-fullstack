############################################################################
# Staging env start/pause control plane.
#
# A tiny always-on Lambda (behind a Function URL) that the "Start/Pause staging
# env" button on staging.loadleadapp.com calls. It scales the EB env's Auto
# Scaling group between 1 (running) and 0 (paused → $0 compute). It lives OUTSIDE
# the EB env on purpose: the env is what's being paused, so the control can't be
# hosted on it. Auth is a shared secret (the backend login can't gate "start" —
# the backend is down when you need to start it).
############################################################################

resource "random_password" "toggle_secret" {
  length  = 40
  special = false # header-safe
}

data "archive_file" "toggle" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/staging-toggle"
  output_path = "${path.module}/.build/staging-toggle.zip"
}

resource "aws_iam_role" "toggle" {
  name = "loadlead-staging-toggle-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "toggle_logs" {
  role       = aws_iam_role.toggle.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "toggle_eb" {
  name = "staging-env-toggle"
  role = aws_iam_role.toggle.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Read env status/health + find its Auto Scaling group. EB describe APIs
        # have no resource-level scoping, so they're on *.
        Sid      = "ReadEnv"
        Effect   = "Allow"
        Action   = ["elasticbeanstalk:DescribeEnvironments", "elasticbeanstalk:DescribeEnvironmentResources"]
        Resource = "*"
      },
      {
        # The whole toggle: read + resize the ASG directly (min/desired 0<->1).
        # DescribeAutoScalingGroups/UpdateAutoScalingGroup don't support
        # resource-level scoping, but this role can do nothing else, and the
        # handler only ever targets the staging env's ASG.
        Sid      = "AsgToggle"
        Effect   = "Allow"
        Action   = ["autoscaling:DescribeAutoScalingGroups", "autoscaling:UpdateAutoScalingGroup"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_lambda_function" "toggle" {
  function_name    = "loadlead-staging-env-toggle"
  role             = aws_iam_role.toggle.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.toggle.output_path
  source_code_hash = data.archive_file.toggle.output_base64sha256
  timeout          = 20
  environment {
    variables = {
      EB_ENV_NAME    = local.backend_env_name
      TOGGLE_SECRET  = random_password.toggle_secret.result
      ALLOWED_ORIGIN = "https://${var.staging_domain}"
    }
  }
  tags = local.tags
}

# Exposed through an API Gateway HTTP API. This account blocks anonymous public
# Lambda function URLs, and OAC-in-front-of-a-function-URL proved unreliable, so
# the boring robust choice wins: an HTTP API is public by default with no
# request signing, and it delivers the SAME payload-format-2.0 event a function
# URL would, so the handler is unchanged. CORS is handled by the API.
resource "aws_apigatewayv2_api" "toggle" {
  name          = "loadlead-staging-env-toggle"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["https://${var.staging_domain}"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-toggle-secret"]
    max_age       = 3600
  }
  tags = local.tags
}

resource "aws_apigatewayv2_integration" "toggle" {
  api_id                 = aws_apigatewayv2_api.toggle.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.toggle.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "toggle" {
  api_id    = aws_apigatewayv2_api.toggle.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.toggle.id}"
}

resource "aws_apigatewayv2_stage" "toggle" {
  api_id      = aws_apigatewayv2_api.toggle.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}

resource "aws_lambda_permission" "toggle_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.toggle.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.toggle.execution_arn}/*/*"
}

output "staging_toggle_url" {
  value = aws_apigatewayv2_api.toggle.api_endpoint
}

output "staging_toggle_secret" {
  description = "Shared secret an engineer pastes into the Start/Pause button once. Retrieve with: tofu output -raw staging_toggle_secret"
  value       = random_password.toggle_secret.result
  sensitive   = true
}
