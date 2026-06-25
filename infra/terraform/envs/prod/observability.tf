############################################################################
# observability.tf — alarms on the infra we built but couldn't otherwise see.
#
# Two distinct gaps these address:
#
# A. WORM sink can fail silently.
#    DDB PutItem on LoadLead_Signatures returns 200 to the app regardless of
#    whether the stream-consumer Lambda actually mirrors the row to S3.
#    Without alarms, a broken Lambda would mean signatures keep landing in
#    the DDB origin (good) while the S3 audit copy quietly drops behind
#    (bad — legal evidence with no second copy). Three alarms below catch
#    every failure mode I could think of:
#      - errors      (handler threw)
#      - throttles   (concurrency exhausted / hit account limit)
#      - iterator_age (Lambda is up but falling behind the stream)
#
# B. Unintended public access / cross-account IAM drift.
#    IAM Access Analyzer is a free account-wide scanner that flags any
#    resource policy (S3, IAM role, KMS, Lambda, SQS, etc.) that grants
#    access to a principal outside the account. Catches the class of
#    mistake where someone widens a bucket policy "just to debug" and
#    forgets to lock it back down.
#
# Alarms go to an SNS topic that has NO subscribers in TF — subscribing an
# email or PagerDuty endpoint is a per-team decision and a one-line
# follow-up (`aws sns subscribe --topic-arn ... --protocol email --notification-endpoint you@...`).
# Alarms still fire and accumulate in CloudWatch even with no subscribers;
# they just don't paginate anyone until a subscription is added.
############################################################################

# ─── SNS topic for ops alerts ─────────────────────────────────────────────
resource "aws_sns_topic" "ops_alerts" {
  name = "loadlead-prod-ops-alerts"

  tags = merge(local.tags, { Component = "observability" })
}

# ─── WORM SINK LAMBDA ALARMS ──────────────────────────────────────────────
# Any error in a 5-minute window means a signature row might not have been
# mirrored. Threshold is 1 — every failure is interesting.
resource "aws_cloudwatch_metric_alarm" "worm_sink_errors" {
  alarm_name          = "loadlead-prod-worm-sink-errors"
  alarm_description   = "WORM sink Lambda threw at least one error in the last 5min. Investigate immediately — DDB Signature writes are succeeding but the S3 audit mirror may be dropping rows."

  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching" # no invocations = no errors, not a failure

  dimensions = {
    FunctionName = aws_lambda_function.signatures_worm_sink.function_name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]

  tags = merge(local.tags, { Component = "observability" })
}

# Throttles = Lambda hit concurrency limit. Different from Errors: the row
# eventually retries (Lambda streams retry indefinitely with our config),
# but sustained throttling means the mirror is permanently behind.
resource "aws_cloudwatch_metric_alarm" "worm_sink_throttles" {
  alarm_name          = "loadlead-prod-worm-sink-throttles"
  alarm_description   = "WORM sink Lambda was throttled (concurrency exhausted). The stream retries automatically but sustained throttling = mirror lag."

  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.signatures_worm_sink.function_name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]

  tags = merge(local.tags, { Component = "observability" })
}

# IteratorAge on a DDB stream Lambda = how far behind real-time the consumer
# is, in milliseconds. > 60s sustained means the stream is processing slower
# than rows are landing. Threshold of 300_000 ms (5 min) is conservative —
# transient spikes during cold start or batching shouldn't fire.
resource "aws_cloudwatch_metric_alarm" "worm_sink_iterator_age" {
  alarm_name          = "loadlead-prod-worm-sink-iterator-age"
  alarm_description   = "WORM sink Lambda is more than 5 min behind the LoadLead_Signatures DDB stream. The mirror is lagging — investigate Lambda concurrency, throttles, or stream shard growth."

  metric_name         = "IteratorAge"
  namespace           = "AWS/Lambda"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3              # 15 min sustained, not a transient spike
  threshold           = 300000         # ms; 5 minutes
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.signatures_worm_sink.function_name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]

  tags = merge(local.tags, { Component = "observability" })
}

# ─── IAM ACCESS ANALYZER (account-wide) ───────────────────────────────────
# Free service; analyzes every resource policy in the account and surfaces
# findings when a resource grants access to a principal outside the account
# (or in S3's case, to "Everyone"). The customer frontend bucket WILL show
# as a finding because it's intentionally public — that's expected and can
# be archived; everything else is genuinely worth investigating.
resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "loadlead-prod-account-analyzer"
  type          = "ACCOUNT"

  tags = merge(local.tags, { Component = "observability" })
}

# ─── Outputs ──────────────────────────────────────────────────────────────
output "ops_alerts_topic_arn" {
  description = <<-EOT
    SNS topic that all observability alarms publish to. Subscribe a real
    endpoint when you're ready, e.g.:
      aws sns subscribe --topic-arn <this> --protocol email \
                        --notification-endpoint you@example.com
    (you'll need to confirm via a link emailed to that address)
  EOT
  value = aws_sns_topic.ops_alerts.arn
}

output "access_analyzer_name" {
  value = aws_accessanalyzer_analyzer.account.analyzer_name
}
