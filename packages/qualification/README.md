# Qualification helpers

This package contains locally runnable correctness and performance diagnostics.
It is not a deployment gate and owns no publication plan, readiness ledger,
staging route, OIDC workflow, alias transition, or release certification.

`qualify:http-profile` runs the common read-only cases through either a local
loopback service or the exact alias-qualified Lambda Function URL recorded in
the closed profile catalog. The target surface intentionally has only those two
kinds. Reports retain exact profile, demo, EACL Core, artifact, deployment, and
data identities and redact credentials and local paths.

The remaining modules are deliberately small:

- `cases.mjs` defines reusable semantic and boundary cases.
- `runner.mjs` bootstraps exact identity and executes those cases.
- `workloads.mjs` measures bounded cold/restore/warm samples and memory
  headroom for manual diagnosis.
- `reports.mjs` writes deterministic redacted JSON and Markdown.

Ordinary delivery is defined only by `.github/workflows/deploy-demos.yml` and
`scripts/deploy-live-demo.mjs`: five independent direct jobs build, deploy, and
smoke every live demo on each push to `demos`.
