# Release identity

Every build, candidate, deployment, descriptor, registry entry, smoke result, rollback coordinate, and evidence record must identify an immutable source pair:

```text
demo-sha = exact 40-hex commit in https://github.com/theronic/eacl-demo.git
eacl-sha = exact 40-hex commit in https://github.com/theronic/eacl.git
```

The `eacl-sha` is read only from `dependencies/eacl-core.lock.json` as committed at `demo-sha`. It is never looked up from a Core branch during a deployment. The checked-out Core repository must be clean, use the canonical origin, and have `HEAD` equal to the lock exactly. The lock contains no parallel branch, reachability, or dependency-certification state.

The following are invalid release identities:

- a branch name such as `main`, `demos`, or `agent/*`;
- a tag without its resolved commit recorded;
- `HEAD`, a pull-request merge ref, a “latest” lookup, or another mutable symbolic ref;
- a local-root or sibling-worktree dependency;
- a dirty tracked checkout, staged-but-uncommitted content, or an untracked source file;
- an artifact whose digest is absent or whose embedded source pair differs from its manifest;
- a Core commit selected by a cross-repository dispatch event instead of the lock committed by the triggering demo revision.

`scripts/generate-deployment-manifest.mjs` enforces the committed lock binding and clean exact-SHA Core checkout. `schemas/deployment-manifest.v1.schema.json` permits SHA fields but no branch fields. Deployment jobs may complete out of order; the descriptor reports the source pair that actually won that profile's alias and makes no latest-source or fleet-convergence claim.

Local checkouts remain useful for development and evidence. They become releasable only after their relevant content is deliberately committed to the correct authority, pushed to a reachable immutable commit, locked by `eacl-demo`, rebuilt from a clean checkout, and bound to artifact digests.

The closed `eacl-demo.release-manifest.v1` adds the canonical fixture manifest digest, `explorer.v1` contract version, every artifact digest and byte size, and the exact GitHub repository/run/attempt identity. The deployment identity includes the immutable demo commit and cannot mean “latest successful” or “current branch head.”

`registry/release-report.v1.json` is a separate content-addressed aggregate. Its checked-in state is deliberately `pre-release`: the report-build demo source, release manifest, artifact identities, qualification evidence, live alarm/budget/Telegram evidence, and rollback coordinates remain null or explicitly unavailable. `npm run build:release-report` derives both that JSON and `docs/release-report.md` from the profile registry, build eligibility, fixture manifests, dependency lock, runtime templates, benchmark evidence files, and cost-control definitions; `npm run verify:release-report` rejects drift. The report-build source identifies the commit that produced the aggregate, not a fleet generation: every profile's deployment identity is independently authoritative, so released reports may truthfully contain mixed main-branch generations. A locally defined template is never promoted to `deployed`, `verified`, `qualified`, or `ready` without the corresponding immutable evidence. The final release-report task remains open until a deployed report can replace those pre-release absences truthfully.
