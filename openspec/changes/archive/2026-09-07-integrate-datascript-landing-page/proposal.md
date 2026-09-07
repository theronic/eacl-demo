## Why

DataScript is the default demo backend, but opening the landing page immediately redirects to a separate entry. Integrating its runtime into the shared SolidJS application removes this extra navigation while keeping server-backend visits lightweight.

## What Changes

- Serve DataScript through the main `/` application without document navigation on startup or backend changes.
- Load the content-addressed EACL/DataScript runtime and embedded fixture only when DataScript is selected, with visible loading, failure, and retry states.
- Automatically restore the canonical 10,000-resource fixture for each fresh DataScript session.
- Enable browser-local, additive seeding with a user-entered resource count, real progress, and refreshed explorer results.
- Keep existing `/datascript/` links working through the shared application and canonicalize their URL without a document redirect.
- Replace route-based bundle isolation with conditional-load checks and update static delivery, publication, and lifecycle verification.

## Capabilities

### New Capabilities

- `datascript-landing-page`: Main-page DataScript selection, conditional runtime loading, compatibility URLs, and session lifecycle.
- `datascript-local-seeding`: Automatic initial fixture restoration and additive browser-local seeding with accurate progress and dataset state.

### Modified Capabilities

None. The only current main spec is `release-identity`; its requirements remain intact. The unarchived `consolidate-eacl-demo-backends` change contains earlier DataScript requirements. This proposal supersedes its separate-entry and cross-document-switching decisions for this work; reconcile those planning artifacts during implementation without archiving unrelated work.

## Impact

Touches `apps/explorer-main`, the runtime currently in `apps/explorer-datascript`, `packages/explorer-state`, browser-local contracts/validators, fixture generation, static assembly and routing, deployment/publication assumptions, and DataScript qualification. Preserve immutable release identity, the direct ClojureScript execution model, and server profiles' read-only API boundaries. No new backend service or worker is required.
