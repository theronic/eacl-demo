# Profile runtime infrastructure

One independently deployable runtime/alias/origin/role unit per server profile. No profile stack owns another profile or a durable dataset.

`datahike-s3-runtime.yaml` binds one existing bucket/store prefix to a Java
25/arm64 Lambda, an exact `s3:GetObject`-only serving role, an immutable
versioned artifact, a public read-only Function URL alias with exact-origin
CORS, fixed concurrency one,
bounded logs, and disabled SnapStart. It cannot list the bucket or write the
marker/data objects and does not provision or reseed the adopted store.

`datahike-dynamodb-runtime.yaml` packages one Java 25/arm64 candidate from an
immutable S3 object version. It creates the serving role next to the runtime so
the role grants exactly `GetItem`, `BatchGetItem`, and `DescribeTable` on one
table plus delivery to one pre-created function log group. The table ARN and
name must agree. Reserved and in-process admission concurrency are both fixed
at one; retry/timeouts are closed environment values. Its Function URL is
public only through the alias-qualified URL invocation condition and exact
demo-origin CORS. SnapStart is explicitly off until restore qualification.

`datomic-dynamodb-runtime.yaml` packages one Java 25/x86_64 fixed-current
candidate from an immutable S3 object version. Its public read-only Function
URL is bound to the candidate alias and exact demo-origin CORS. SnapStart is
explicitly off until the required
non-SnapStart memory sweep passes; promotion of a healthy version to a live
alias remains a separate operation.

`datomic-dynamodb-serving-role.yaml` grants the read-only Peer exactly the four
DynamoDB actions documented by Datomic (`GetItem`, `BatchGetItem`, `Scan`, and
`Query`) on one generation table. Its only other permissions deliver logs to a
pre-created, exact function log group. Writes, administration, KMS, other
tables, seed operations, and transactor operations are implicit-deny.

`datalevin-memory-runtime.yaml` defines only the eventual qualification
boundary: managed Java 25/arm64, one in-process concurrency slot, a 512 MiB
ephemeral surface, SnapStart on published versions, an embedded immutable
10,000-resource fixture, and an execution role that can only read one exact
version of an external lifecycle-metadata object and deliver logs. It offers
the two closed lifecycle-strategy inputs but marks the candidate blocked. The
metadata schema fixes a deterministic native source UUID and final revision;
it is not the Datalevin store and cannot be written by the runtime. The
template is not a runtime artifact and cannot override the unpublished
maintained-fork release, incompatible arm64 native closure, or
lifecycle-evidence gates recorded in `dependencies/datalevin-memory.v1.json`.

`jank-memory-runtime.yaml` owns its execution role rather than accepting an
arbitrary role ARN. The custom runtime can create a stream and write events
only in its pre-created exact log group; it has no S3, DynamoDB, EFS, EC2,
KMS, mutation, or role-delegation permission. It defines an immutable candidate
version, nonnumeric alias, and public alias-qualified Function URL with exact
demo-origin CORS, but that
deployment boundary does not make the profile eligible before the pinned
Linux x86_64 AL2023 native artifact and staged evidence exist.

Serving roles use only inline, auditable policies and never attach a managed
policy. Stateful maintenance identities are separate. The temporary Datomic
EC2 writer alone attaches the exact AWS-managed `AmazonSSMManagedInstanceCore`
policy so the dispatch-only workflow can run commands without inbound SSH; its
DynamoDB and S3 data-plane statements remain exact-resource scoped, and the
SSM policy is forbidden from every serving role.

Public Function URL invocation is not storage authority. Each public resource
policy is scoped to `lambda:FunctionUrlAuthType=NONE` or
`lambda:InvokedViaFunctionUrl=true`; the runtime exposes only the closed
read-only API and its serving role has no maintenance or write permissions.
