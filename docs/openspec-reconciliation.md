# Sibling OpenSpec reconciliation

This record reconciles the consolidated demo with the active planning changes
under `/Users/petrus/code/eacl/openspec/changes`. It does not edit, complete, or
archive those changes and does not turn their dirty local worktrees into release
inputs. The consolidated repository consumes EACL Core only through
`dependencies/eacl-core.lock.json`, currently pinned to
`224da2a3e4c3acc574afad85128c679759d6d0a6`.

## Decision matrix

| Sibling change | Adopted here | Prerequisite for this change | Superseded here | Still independent |
| --- | --- | --- | --- | --- |
| `add-datalevin-backend-and-demo` | The backend-neutral owned-snapshot lifecycle, Datalevin adapter semantics, explicit close/thread rules, and limitation vocabulary available at the locked Core revision. | A published/clean-consumer Datalevin fork and module closure, Linux arm64 native packaging, and the Lambda-specific lifecycle/watermark/SnapStart qualification required by consolidated tasks 10.1–10.8. Local source success alone cannot enable `datalevin-memory`. | A copied standalone SolidJS client is not the canonical explorer; the shared explorer/contract/fixture packages in `eacl-demo` own that UI. | Publication of `dev.eacl/eacl-datalevin`, its full platform matrix, and the durable single-writer EC2 service at `datalevin.eacl.dev` remain owned by the sibling change. That durable service is not evidence for the ephemeral Lambda lifecycle and is not retired by this change. |
| `deploy-datahike-demo` | Read-only inventory of its existing S3 store/runtime, UI behavior used as design input, and operational findings. The exact adoption decision is `docs/provenance/datahike-s3-adoption-2026-08-25.md`; component/state decisions are in `docs/explorer-source-inventory.md`. | The consolidated Datahike/S3 profile must still rebuild a clean exact-SHA read-only artifact, bind an honest legacy dataset identity, qualify its production route, and remain outside same-fixture S3/DynamoDB ranking until the datasets really match. | Its standalone server/client and `/datahike`-specific deployment are not the future canonical `demo.eacl.dev` shell. The consolidated private-S3/CloudFront shell and isolated Lambda profiles replace that serving architecture only after staged cutover. | Audit/handoff of the current service and any approved legacy bucket cleanup remain sibling operations. No previous approval to replace or delete its buckets, EC2, DNS, alarms, or data is inherited. The current deployment remains a fallback/legacy resource until separately inventoried and approved for retirement. |
| `add-private-spicedb-adapter` | Only backend-neutral Core behavior already present at the exact locked Core SHA, such as portable errors or parser/consistency fixes, can be consumed indirectly. No private source is copied. | None for the initial consolidated backend set. Advancing the Core lock later requires the normal clean-build/contract checks, not private-adapter completion. | Nothing: SpiceDB is not advertised as a consolidated profile. | The private adapter, differential suite, immutable public EACL coordinate, clean Java consumer, and private release gates remain entirely independent and non-gating for demo deployment. |
| `build-edrive` | Nothing; the directory contains no proposal, design, specification, or task artifact to adopt. | None. | Nothing. | Any future EDrive work must propose its own relationship to the demo before it can affect this change. |

## Evidence boundaries

Adopted evidence is copied or referenced as an immutable, reviewable record; it
is not inferred from the current contents of a dirty sibling worktree. In
particular:

- `docs/provenance/datahike-s3-adoption-2026-08-25.json` binds the observed
  Datahike alias/artifact/store facts and explicitly records why they do not
  enable the profile.
- `docs/provenance/source-state-2026-08-25.json` binds the legacy UI/source
  inventories and their dirty-state manifests.
- the EACL Core lock binds every module source to one exact commit and contains
  no parallel branch or reachability state.
- the consolidated fixture, contracts, registry, artifacts, and qualification
  results are owned by `eacl-demo` and cannot be satisfied by relabelling a
  sibling result from a different source, fixture, runtime, or topology.

## Deployment and retirement boundary

The consolidated deployment may coexist with every sibling deployment during
staging and observation. Cutover does not stop or delete a sibling resource.
`demo.eacl.dev` DNS changes require the consolidated change's immediate
approval gate; deletion or permanent stopping of the old Datahike service,
bucket, EC2 resources, alarms, or backups requires a later exact-target impact
report and separate approval. The Datalevin EC2 service, if completed, remains
a different durable/history/topology demonstration rather than a Lambda
rollback target.

## Status consequence

This reconciliation completes only the planning relationship among changes.
It does not close the remaining Datalevin platform/release gates, qualify or
enable Datahike, authorize legacy retirement, or transfer incomplete sibling
task checkboxes into this change.
