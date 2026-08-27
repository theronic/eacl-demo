# Legacy retirement impact, recovery, backup, and cost report — 2026-08-27

This is a read-only inventory and retirement plan. It authorizes no stop,
delete, overwrite, DNS change, data copy, or ownership transfer. Each material
batch still requires separate explicit approval under tasks 16.8 and 16.9.

## Executive decision

Do not delete any legacy stack as a unit. The production Datahike/S3 profile
adopted the legacy Datahike store, but that bucket is still a resource of the
legacy EC2 stack. The current execution role
`eacl-demo-datahike-s3-live-ExecutionRole-dRRxJB2SVTNH` has exact read-only
`s3:GetObject` access to
`arn:aws:s3:::demo-eacl-datahike-v2-843761893873-us-east-1/4e67bb31-557d-4f49-8b4c-699d39577310_*`.
The store must be backed up and transferred to independently managed ownership
before any operation that could remove the bucket, its store prefix, or access.

The stopped EC2 host is not serving production. The separate legacy serverless
deployment remains a healthy, independently certified fallback at
`serverless-datahike.demo.eacl.dev`; its exact probe evidence is in
`verification/results/legacy-fallback-2026-08-27.json`.

## Exact legacy inventory and dependencies

### `demo-eacl-datahike`

CloudFormation stack
`arn:aws:cloudformation:us-east-1:843761893873:stack/demo-eacl-datahike/65066220-9660-11f1-9f9d-1296f31f05d1`
owns:

| Kind | Exact identifier | Current state / dependency |
| --- | --- | --- |
| EC2 | `i-04761ff3afba454ab` | stopped; `t4g.large`, arm64 |
| EBS | `vol-0f89b55a3ce8a0b69` | attached, encrypted 20 GiB gp3, delete-on-termination |
| Elastic IP | `eipalloc-0bd76345f5c728f34` / `54.163.189.23` | associated with the stopped instance |
| VPC | `vpc-04d77fa150bcd3ed0` | contains the legacy subnet and endpoint |
| subnet | `subnet-0bf3ebe11472453b6` | public subnet |
| security group | `sg-0afe95e621ee18ff0` | legacy instance ingress |
| internet gateway | `igw-0d349cabe0dd9bb5f` | attached to the VPC |
| route table | `rtb-0be9407b918905318` | default route plus association `rtbassoc-0e9061f50d7385532` |
| S3 endpoint | `vpce-0f4da2496adcf8004` | gateway endpoint for the legacy VPC |
| key pair | `demo-eacl-datahike-operator` | operator access coordinate |
| instance role | `demo-eacl-datahike-DatahikeRole-78J1esVepYAG` | legacy EC2 access |
| instance profile | `demo-eacl-datahike-DatahikeInstanceProfile-ccCHz4mCpcxN` | attaches the role to EC2 |
| S3 bucket | `demo-eacl-datahike-v2-843761893873-us-east-1` | live adopted Datahike/S3 store; production dependency |

The S3 bucket uses AWS-owned AES-256 encryption and denies insecure transport.
It has no bucket versioning, lifecycle rule, or replication configuration.
The latest daily CloudWatch sample was 1,214,385,144 bytes and 120,727 objects;
the metric varied during the preceding week, so it is evidence of size rather
than a sealed backup. No project-tagged EBS snapshot exists. The attached root
volume references launch snapshot `snap-01f98e274548cbfd4`, which is not a
backup of later instance state.

### `demo-eacl-datahike-monitoring`

CloudFormation stack
`arn:aws:cloudformation:us-east-1:843761893873:stack/demo-eacl-datahike-monitoring/69ff5730-96fd-11f1-93f6-121a4259779f`
owns the following dependency set:

- SNS topic `arn:aws:sns:us-east-1:843761893873:demo-eacl-datahike-alarms`
- Lambda functions `demo-eacl-datahike-capacity-controller` and
  `demo-eacl-datahike-telegram-notifier`, their roles, permissions,
  subscriptions, and 14-day log groups
- Secrets Manager secret identifier
  `arn:aws:secretsmanager:us-east-1:843761893873:secret:demo/eacl/datahike/telegram-oM4WGQ`
  (the value was not read)
- SSM document `demo-eacl-datahike-capacity-suspend`
- dashboard `demo-eacl-datahike`
- Route 53 health check `2a5202a6-60fb-45e4-9923-5a9786d664c1`
- ten metric alarms covering EC2, the capacity controller, S3 requests, and
  public health

The stopped-instance alarms and stale public-health alarm have actions disabled.
The health check still probes `https://demo.eacl.dev/datahike/api/health`, which
now correctly returns 403 under the consolidated distribution; all sampled
Route 53 checkers therefore reported failure. S3 request alarms and the
capacity-controller error alarm remain action-enabled. This monitoring stack
must not be confused with the independent `eacl-demo-observability` stack.

### `demo-eacl-datahike-lambda-reader`

CloudFormation stack
`arn:aws:cloudformation:us-east-1:843761893873:stack/demo-eacl-datahike-lambda-reader/78530570-9d74-11f1-b0ff-121e41b6e761`
owns:

- Java 25 arm64 function `demo-eacl-datahike-lambda-reader-reader`, 1,024 MiB,
  35-second timeout, with immutable version `133`
- aliases `live` and `benchmark`; `live` points to version `133`
- public Function URLs for both aliases; the live URL is
  `https://5tqpr2yjsrujdabeix6gfkis540xoplq.lambda-url.us-east-1.on.aws/`
- layer `arn:aws:lambda:us-east-1:843761893873:layer:ReaderCacheExtensionLayer:5`
- S3 Express directory bucket
  `demo-eacl-datahik-readercachebucke-fucenilrmipn--use1-az4--x-s3`
- role `demo-eacl-datahike-lambda-reader-ReaderRole-Pxn0RZew3DD1`
- 30-day log group `/aws/lambda/demo-eacl-datahike-lambda-reader-reader`
- four Lambda/cost alarms, currently `OK`

The reader depends on the adopted S3 data bucket and its cache directory bucket.
Its public live alias is also an origin of the legacy serverless distribution.

### `demo-eacl-datahike-serverless-domain`

CloudFormation stack
`arn:aws:cloudformation:us-east-1:843761893873:stack/demo-eacl-datahike-serverless-domain/6f25f3a0-9d87-11f1-9107-12826034c1f1`
owns:

- deployed distribution `EYDAU1XQ7KZLQ` / `d1hfgknwkzo8a1.cloudfront.net`
- A and AAAA aliases for `serverless-datahike.demo.eacl.dev`
- issued, renewal-eligible certificate
  `arn:aws:acm:us-east-1:843761893873:certificate/cbf351ed-d1a1-4d01-ae74-53fcf5a7ad7d`,
  valid through 2027-03-06T23:59:59Z
- private static bucket
  `demo-eacl-datahike-serverless-dom-staticsitebucket-m9ovhn4bfnjo`, bucket
  policy, origin access control `E29VKUK6WR2RQ0`, and rewrite function
  `demo-eacl-datahike-serverless-domain-static-rewrite`

`/datahike/api/*` routes to the legacy live Lambda URL and
`/datahike/assets/*` routes to the static bucket. On 2026-08-27 the root returned
200 in 0.481 seconds and health returned ready/200 in 3.193 seconds.

### Other legacy public surface

`explorer.eacl.dev` is a 300-second CNAME to `theronic.github.io`, outside these
AWS stacks. It remains an independent legacy DataScript/GitHub Pages surface.
Its DNS record must not be removed as part of an AWS Datahike retirement batch.

## Recovery and backup requirements

Before any approved retirement action:

1. Create and verify an immutable backup of the exact adopted S3 store prefix;
   record bucket/version or archive identity, manifest digest, object count,
   byte count, encryption, restore command, and a clean restore probe. Current
   unversioned storage is not a backup.
2. Transfer the adopted data bucket and policy out of the legacy EC2 stack, or
   update the stack with an explicit retain/import plan, and prove the current
   production Datahike/S3 role still reads only the exact store prefix.
3. If EC2 recovery is still required, snapshot `vol-0f89b55a3ce8a0b69`
   before detaching, terminating, or deleting the stack. The current launch
   snapshot is insufficient for post-launch state.
4. Retain Lambda version `133`, the live alias coordinate, static manifest,
   certificate, DNS records, and the serverless distribution until an approved
   fallback-retirement window closes.
5. Export only non-secret monitoring configuration and verify the consolidated
   Telegram notifier owns every still-required route before removing the legacy
   SNS topic, notifier, or secret.
6. Remove stale health checks and alarms only in their own approved batch; never
   combine that action with data, DNS, or compute deletion.

Recovery today is asymmetric: the serverless fallback is immediately healthy;
the EC2 path requires starting `i-04761ff3afba454ab` and separately restoring a
hostname/routing path. No current certificate-backed hostname points directly to
the stopped EC2 service.

## Cost report

The identifiable fixed list-price floor is approximately **USD 7.03 per
30-day month**, before account-wide free tiers, taxes, requests, transfer,
Lambda duration, logs, and the unmeasured S3 Express/static storage:

| Item | Basis | Approximate monthly list price |
| --- | --- | ---: |
| associated public IPv4 | 720 hours × USD 0.005/hour | USD 3.60 |
| 20 GiB gp3 volume | 20 × USD 0.08/GiB-month; baseline IOPS/throughput | USD 1.60 |
| adopted S3 Standard data | latest 1.214 GB × USD 0.023/GB-month | USD 0.03 |
| one Secrets Manager secret | USD 0.40/secret-month | USD 0.40 |
| fourteen standard alarm metrics | 14 × USD 0.10/month before free tier | USD 1.40 |

The stopped EC2 instance has no compute charge while stopped. The associated
IPv4 address and EBS volume continue billing. The Route 53 health check may fall
within the first-50 AWS-endpoint offer, while HTTPS is an optional feature;
CloudFront, Lambda, and SNS may fall within account-wide monthly allowances but
must be checked against the whole account rather than assumed free. The legacy
Lambda, S3 request volume, S3 Express cache size, static bucket size, DNS
queries, and log ingestion are variable and were deliberately not scanned or
exercised merely to estimate cost.

Pricing references: [VPC public IPv4](https://aws.amazon.com/vpc/pricing/),
[EBS gp3](https://aws.amazon.com/ebs/pricing/),
[S3](https://aws.amazon.com/s3/pricing/),
[CloudWatch](https://aws.amazon.com/cloudwatch/pricing/),
[Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/),
[Route 53](https://aws.amazon.com/route53/pricing/),
[Lambda](https://aws.amazon.com/lambda/pricing/), and
[CloudFront](https://aws.amazon.com/cloudfront/pricing/).

## Separately approvable retirement batches

1. Stale health-check and alarm cleanup only.
2. EC2/EIP/VPC retirement after a current EBS snapshot and recovery decision.
3. Legacy Lambda reader and S3 Express cache retirement after the fallback
   window, with the adopted data bucket explicitly excluded.
4. Serverless distribution/static/DNS/certificate retirement after fallback
   approval and an elapsed DNS recovery window.
5. Monitoring/SNS/notifier/secret retirement after route reconciliation.
6. Adopted S3 ownership transfer and backup verification; deletion of the
   adopted data is a separate, last, explicitly named operation and is not
   recommended while Datahike/S3 remains enabled.
