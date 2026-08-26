# Foundation infrastructure

`template.yaml` is the independently deployable storage foundation. It creates
private, versioned artifact, static, and runtime-state buckets with public
access blocked, SSE-S3 (`AES256`), retained data, and a SigV4 CloudFront origin
access control. Artifact and static noncurrent versions have bounded retention.
The runtime-state bucket holds tiny immutable, exact-version control-plane
records such as Datalevin lifecycle/watermark metadata; it is not a profile
data store, and noncurrent records are not automatically expired because they
may be rollback evidence. The foundation deliberately creates no DNS record,
distribution, table, function, or customer-managed KMS key.

The later static stack consumes the bucket and origin-access-control outputs.
That split keeps a static deploy from replacing retained storage and keeps the
production DNS approval gate independent.
