# Release identity

Every build, candidate, deployment, descriptor, registry entry, smoke result, rollback coordinate, and evidence record must identify an immutable source pair:

```text
demo-sha = exact 40-hex commit in https://github.com/theronic/eacl-demo.git
eacl-sha = exact 40-hex commit in https://github.com/theronic/eacl.git
```

The `eacl-sha` is derived only from the `deps.edn` committed at `demo-sha` (`scripts/lib/eacl-core.mjs`). It is never looked up from a Core branch during a deployment. The checked-out Core repository must be clean, use the canonical origin, and have `HEAD` equal to the derived pin exactly. The pin carries no parallel branch, reachability, or dependency-certification state.

The following are invalid release identities:

- a branch name such as `main`, `demos`, or `agent/*`;
- a tag without its resolved commit recorded;
- `HEAD`, a pull-request merge ref, a “latest” lookup, or another mutable symbolic ref;
- a local-root or sibling-worktree dependency;
- a dirty tracked checkout, staged-but-uncommitted content, or an untracked source file;
- an artifact whose digest is absent or whose embedded source pair differs from its manifest;
- a Core commit selected by a cross-repository dispatch event instead of the `deps.edn` pin committed by the triggering demo revision.

`scripts/generate-deployment-manifest.mjs` enforces the committed `deps.edn` binding and clean exact-SHA Core checkout. `schemas/deployment-manifest.v1.schema.json` permits SHA fields but no branch fields. Deployment jobs may complete out of order; the descriptor reports the source pair that actually won that profile's alias and makes no latest-source or fleet-convergence claim.

Local checkouts remain useful for development and evidence. They become releasable only after their relevant content is deliberately committed to the correct authority, pushed to a reachable immutable commit, pinned by `eacl-demo`'s `deps.edn`, rebuilt from a clean checkout, and bound to artifact digests.

The closed `eacl-demo.release-manifest.v1` adds the canonical fixture manifest digest, `explorer.v1` contract version, every artifact digest and byte size, and the exact GitHub repository/run/attempt identity. The deployment identity includes the immutable demo commit and cannot mean “latest successful” or “current branch head.”

There is no checked-in deployment registry or release report: deployment
outcomes live only in the per-profile documents that deploy jobs publish to
the live site (`registry/profiles/<id>.json`), each carrying its own immutable
source pair.
