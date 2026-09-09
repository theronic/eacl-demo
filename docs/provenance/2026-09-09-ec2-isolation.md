# EC2 isolation and concurrency release

Released production commit `0ca8dba00465296cb4ad3d9b6777af364e5b3ed5`, retaining EACL core `6982d388b4f4472cfc69dae0f92adc58c62438d8`.

- PR: https://github.com/theronic/eacl-demo/pull/104
- Successful five-job deployment: https://github.com/theronic/eacl-demo/actions/runs/34385331609
- Datomic: `i-01f2d07f50ad1cb5d`, t3.micro, four engine permits, existing Standard credit mode.
- Datalevin: `i-088bcf1a4dd88e165`, dedicated t3.micro, existing one-permit runtime setting, Unlimited credit mode.
- Datalevin compute stack: `eacl-demo-datalevin-memory-ec2`; only the existing VPC/subnet are shared.
- Public URLs are unchanged. Datalevin CloudFront now uses `datalevin-origin.demo.eacl.dev`.

The old Datalevin association was removed from the Datomic stack. Its systemd unit on the Datomic machine is inactive, disabled and has MainPID=0. Datomic remained active. Datalevin deployment has its own GitHub environment instance variable and exact-instance SSM permission; the production deployment successfully exercised that path.

The full elapsed measurement remains unchanged: admission wait, snapshot acquisition and EACL operation remain included. No authorization, consistency, fixtures, or Lambda runtime settings changed.

## Measurements

A host-local workload submitted one cache-disabled count (ceiling 1,000) followed by four cache-disabled 20-account relationship reads, repeated five times. Reported relationship latency across 20 samples:

| Datomic admission limit | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: |
| 1 | 159.87ms | 106.57ms | 249.64ms |
| 4 | 15.18ms | 6.57ms | 118.35ms |

This small before/after experiment includes JVM warm-up and changing host memory state; it is not an SLO or an isolated causal benchmark. It establishes that the previous serialized demo queue substantially delayed cheap reads in the observed workload.

Before separation, the shared host had 24MiB available RAM and 482MiB in swap. After stopping Datalevin, an observed Datomic sample had about 210MiB available; a subsequent idle vmstat sample showed no active swap I/O. The dedicated Datalevin host passed readiness with about 302MiB available and no swap usage. Its initial Standard-mode credit balance was zero and delayed initialization, so Unlimited mode was enabled; sustained above-baseline use may incur CPU-credit charges.

## Verification

- 16 infrastructure/deployment-policy tests, CloudFormation validation and the AWS cost-control audit passed.
- New Datalevin artifact/data identity, direct first/next pagination and allow/deny checks passed before CloudFront cutover.
- CloudFront reported Deployed on the dedicated origin before the old service was stopped.
- Both EC2 demos passed public browser startup after the production deployment.
- All nine public JVM targets passed exact release identity, direct pagination and obsolete relationship-authorization field rejection.
- Deployment logs confirm all seven Lambda functions deleted one stale version and retained three published packages each.

Raw local evidence is under ignored `target/concurrency-review/`: baseline.json, candidate.json, public-matrix.json, deployment.log and CloudFormation/SSM review files. Infrastructure bootstrap parameters identify an immutable artifact; future infrastructure updates must use the intended published release identity, while ordinary releases continue through the deployment workflow.
