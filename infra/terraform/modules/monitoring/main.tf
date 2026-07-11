# monitoring — CloudWatch alarms for the scale-readiness program (audit v4
# COA-3B). Two signal classes the v4 audit called out as missing before beta
# scale-up:
#   1. DynamoDB throttles on the hot tables - the first observable symptom of
#      the scan-at-scale class (H3) actually biting.
#   2. EB environment health - the composite that catches boot refusals (the
#      COA-3A index assertion), 5xx storms, and instance death.
# Alarms publish to one SNS topic per env; subscribe an email/pager via
# `alert_email` (empty = topic only, subscribe later in the console - avoids
# sending a confirmation email nobody asked for).

variable "env" { type = string }
variable "tags" { type = map(string) }

variable "alert_email" {
  description = "Optional email for alarm notifications. Empty string creates the topic with no subscription (subscribe via console when ready)."
  type        = string
  default     = ""
}

variable "hot_tables" {
  description = "DynamoDB table names to alarm on read/write throttles (the request-hot tables from the v4 audit)."
  type        = list(string)
}

variable "eb_environment_name" {
  description = "Elastic Beanstalk environment to alarm on degraded health. Requires enhanced health reporting; with basic health the metric is absent and the alarm stays OK (missing = notBreaching)."
  type        = string
  default     = ""
}

resource "aws_sns_topic" "alerts" {
  name = "loadlead-${var.env}-platform-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# One alarm per hot table: read + write throttle events summed via metric
# math. On PAY_PER_REQUEST tables a sustained throttle means the access
# pattern (hot partition / scan storm) is the problem - exactly the signal
# the audit wants surfaced before users feel it.
resource "aws_cloudwatch_metric_alarm" "ddb_throttles" {
  for_each = toset(var.hot_tables)

  alarm_name          = "loadlead-${var.env}-ddb-throttles-${each.value}"
  alarm_description   = "Read+write throttle events on ${each.value} (audit v4 COA-3B). Sustained throttles on on-demand tables = hot partition or scan storm."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags

  metric_query {
    id          = "total"
    expression  = "reads + writes"
    label       = "Throttle events (read+write)"
    return_data = true
  }
  metric_query {
    id = "reads"
    metric {
      metric_name = "ReadThrottleEvents"
      namespace   = "AWS/DynamoDB"
      period      = 300
      stat        = "Sum"
      dimensions  = { TableName = each.value }
    }
  }
  metric_query {
    id = "writes"
    metric {
      metric_name = "WriteThrottleEvents"
      namespace   = "AWS/DynamoDB"
      period      = 300
      stat        = "Sum"
      dimensions  = { TableName = each.value }
    }
  }
}

# EB EnvironmentHealth: 0=Ok .. 20=Degraded, 25=Severe. Alarm at Degraded+
# for 2 consecutive periods so a normal deploy roll doesn't page.
resource "aws_cloudwatch_metric_alarm" "eb_health" {
  count = var.eb_environment_name == "" ? 0 : 1

  alarm_name          = "loadlead-${var.env}-eb-environment-degraded"
  alarm_description   = "EB environment ${var.eb_environment_name} Degraded/Severe for 10+ minutes (audit v4 COA-3B). Catches boot refusals, 5xx storms, instance death."
  namespace           = "AWS/ElasticBeanstalk"
  metric_name         = "EnvironmentHealth"
  dimensions          = { EnvironmentName = var.eb_environment_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 20
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
