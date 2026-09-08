## Why

The explorer currently devotes a full column to choosing a subject and stacks large configuration panels above the authorization results. EACL needs a more persuasive product demonstration: let visitors immediately explore what a principal can access, inspect who can access a resource, and see the consistency and measurement context behind each answer.

## What Changes

- Move principal selection into a top-right picker with quick subjects and the existing paginated known-user browser; remove the persistent subject-selection column.
- Establish two primary columns: a large resource exploration pane rooted in schema resource types, and a compact resource access inspector for `lookup-subjects` and independent permission checks.
- Adapt the square plus/minus disclosures, separate expansion and selection, aligned count rails, hierarchy guides, retained branch state, and keyboard navigation from 0tx Unified Ledger and Peach Explorer. Preserve lazy bounded lookups and distinguish resource-type discovery from relationship traversal.
- Give the shared demos a coherent light/dark visual system, compact profile and consistency controls, and progressive disclosure for schema, cache diagnostics, and query evidence.
- Preserve all existing explorer capabilities, especially consistency modes and their descriptor limitations, snapshot selection/refresh, freshness floors, cache controls, pagination/recovery, standalone permission checks, deployment identity, and local seeding. Preserve the separate local caveats/expiry playground.
- Show operation-scoped timing, cache, count completeness, and basis evidence without unsupported speed claims or cross-dataset comparisons.
- Provide an isolated, interactive local design preview on a Git branch, with explicitly illustrative data and no fabricated benchmark measurements, before replacing the connected shell.

## Capabilities

### New Capabilities

- `resource-first-explorer`: Two-column information architecture, principal picker, bounded nested resource navigation, access inspector, consistency/evidence presentation, feature preservation, and accessible visual design.

### Modified Capabilities

None. The related `unified-demo-shell` specification remains in the active `consolidate-eacl-demo-backends` change rather than the main spec tree. This change adds complementary requirements without editing that change or presenting its pending delta as an archived main capability.

## Impact

- Implementation targets `apps/explorer-main/src/Explorer.tsx`, shared explorer components/styles, and relevant selection/focus/presentation state under `packages/explorer-state`. Existing API dispatch, validators, response identity checks, and transport isolation remain authoritative.
- Adds a local preview under `docs/design-preview/` and a loopback-only preview server script. The preview is outside production build inputs and uses no external services or additional dependencies.
- Verification covers browser interaction and accessibility, preservation of existing state/contract tests, and connected profile behavior during the later apply phase. This proposal does not change authorization semantics, deployed infrastructure, EACL Core, or the eDrive and reference repositories.
