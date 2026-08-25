# AWS estate provenance

Captured at `2026-08-25T10:02:57.822Z` from profile `petrus-prod` in `us-east-1` for OpenSpec task 1.2. The JSON companion is authoritative and has SHA-256 `f44ec638db669b6bf0ab037bce58f07642f1d7a639ea435a19ee860444502f6d`.

This capture used read-only AWS APIs. It deliberately excludes Lambda environment variables, secret values, DNS TXT records, certificate validation records, credentials, and unrelated account resources.

## Identity

- Account: `843761893873`
- ARN: `arn:aws:iam::843761893873:root`
- Region: `us-east-1`

## Relevant resources

- CloudFormation stacks: `demo-eacl-datahike-serverless-domain`, `demo-eacl-datahike-lambda-reader`, `demo-eacl-datahike-monitoring`, `demo-eacl-datahike`
- Lambda functions: `demo-eacl-datahike-lambda-reader-reader`, `demo-eacl-datahike-telegram-notifier`, `demo-eacl-datahike-capacity-controller`
- DynamoDB tables: none
- S3 buckets: `demo-eacl-datahike-843761893873-us-east-1`, `demo-eacl-datahike-serverless-dom-staticsitebucket-m9ovhn4bfnjo`, `demo-eacl-datahike-v2-843761893873-us-east-1`
- CloudWatch metric alarms: `demo-eacl-datahike-capacity-controller-failed`, `demo-eacl-datahike-high-cpu`, `demo-eacl-datahike-instance-unresponsive`, `demo-eacl-datahike-lambda-reader-ErrorAlarm-LYQ0MDSVds0W`, `demo-eacl-datahike-lambda-reader-ProjectedMonthlyCostAlarm-n00U2sJ3c2dy`, `demo-eacl-datahike-lambda-reader-ThrottleAlarm-IIiA3UYHylYU`, `demo-eacl-datahike-lambda-reader-UrlServerErrorAlarm-ymJnvBLvc90K`, `demo-eacl-datahike-low-cpu-credits`, `demo-eacl-datahike-low-memory`, `demo-eacl-datahike-public-health-failed`, `demo-eacl-datahike-s3-get-cost-critical`, `demo-eacl-datahike-s3-get-cost-warning`, `demo-eacl-datahike-s3-put-cost-critical`, `demo-eacl-datahike-s3-put-cost-warning`
- CloudWatch composite alarms: none
- SNS topics: `arn:aws:sns:us-east-1:843761893873:demo-eacl-datahike-alarms`
- Secrets Manager metadata (values never read): `demo/eacl/datahike/telegram`
- CloudFront distributions: `EYDAU1XQ7KZLQ`
- ACM certificates: `serverless-datahike.demo.eacl.dev`
- Tagged active/stopped EC2 instances: `i-04761ff3afba454ab`
- Relevant EBS volumes: `vol-0f89b55a3ce8a0b69`
- Relevant Elastic IPs: `eipalloc-0bd76345f5c728f34`
- Relevant EBS snapshots: none
- Relevant owned AMIs: none
- AWS Backup vaults: none
- Budgets: none
- Cost anomaly monitors: none

## Public identities

- `demo.eacl.dev`: `54.163.189.23`
- `serverless-datahike.demo.eacl.dev`: `52.85.25.68`, `52.85.25.107`, `52.85.25.54`, `52.85.25.38`
- `explorer.eacl.dev`: `theronic.github.io.`, `185.199.111.153`, `185.199.108.153`, `185.199.110.153`, `185.199.109.153`

## Capture failures

None.
