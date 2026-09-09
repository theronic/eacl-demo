## Why

The explorer currently devotes a full column to choosing a subject and stacks large configuration panels above the authorization results. EACL needs a more persuasive product demonstration: let visitors immediately explore what a principal can access, inspect who can access a resource, and see the consistency and measurement context behind each answer.

## What Changes

- Move principal selection into a top-right View As picker with quick users, a schema-derived subject-type selector, and bounded object browsing; remove the persistent subject-selection column.
- Establish two primary columns: a large resource exploration pane rooted in schema resource types, and a compact resource access inspector for `lookup-subjects` and independent permission checks.
- Adapt the square plus/minus disclosures, separate expansion and selection, counts with adjacent timings, hierarchy guides, retained branch state, and keyboard navigation from 0tx Unified Ledger and Peach Explorer. Preserve lazy bounded lookups and distinguish resource-type discovery from relationship traversal.
- Give the shared demos a coherent light/dark visual system, the original native-radio selector model in stable Backend, Storage, and Execution rows, and a collapsible compact Consistency Mode radio section. Backend labels contain names only; storage choices appear on their own row. Retain the 🦅 eagle logo and EACL Explorer title. Use the user-supplied factual subtitle exactly, with readable typography and information density taking priority over decoration.
- Preserve all existing explorer capabilities, especially consistency modes and their descriptor limitations, snapshot selection/refresh, freshness floors, cache controls, pagination/recovery, standalone permission checks, deployment identity, and local seeding. Preserve the separate local caveats/expiry playground.
- Keep prominent branch ranges/counts, their combined latency/cache badges immediately together beside each lookup, count, permission decision, and reverse lookup. Do not add a separate timing column, global query-evidence strip, query-activity dashboard, or browser-only resource search. Retain the original cache controls and diagnostics.
- Preserve the canonical stress-test schema, resource identifiers, fixture generation, parent chains, intentional cycles, and dataset sizes. This is an interface redesign; replacement datasets, friendly-name aliases, and simplified permission models are excluded.
- Provide an isolated, interactive local design preview on a Git branch, over the existing compiled DataScript runtime and original 10,000-resource fixture, with actual local response latency/cache metadata immediately beside the corresponding query result, before replacing the connected shell. Other profile choices show existing catalog options but remain explicitly disconnected in the local preview.

## Capabilities

### New Capabilities

- `resource-first-explorer`: Two-column information architecture, principal picker, bounded nested resource navigation, access inspector, consistency/evidence presentation, feature preservation, and accessible visual design.

### Modified Capabilities

None. The related `unified-demo-shell` specification remains in the active `consolidate-eacl-demo-backends` change rather than the main spec tree. This change adds complementary requirements without editing that change or presenting its pending delta as an archived main capability.

## Impact

- Implementation targets `apps/explorer-main/src/Explorer.tsx`, shared explorer components/styles, and relevant selection/focus/presentation state under `packages/explorer-state`. Existing API dispatch, validators, response identity checks, and transport isolation remain authoritative.
- Adds a local preview under `docs/design-preview/` and a loopback-only preview server script. The preview is outside production build inputs and uses no external services or additional dependencies. The local command requires the existing `build:datascript-runtime` output and verifies its artifact digest and the canonical schema digest.
- Verification covers browser interaction and accessibility, preservation of existing state/contract tests, and connected profile behavior during the later apply phase. This proposal does not change authorization semantics, deployed infrastructure, EACL Core, or the eDrive and reference repositories.

The subtitle is: “EACL is Situated ReBAC Authorization Library backed by Datomic Pro, Datahike, Datalevin or DataScript.”

The 2026-09-09 revision retains a single navbar title, prominent source links and object/relationship counts, removes the principal total, makes backend configuration collapsible, and places basis information beside Refresh Snapshot. The tree uses document scrolling with branch-local pagination and a collapsible floating permission checker. Subject/resource type and ID controls, discovered-ID autocomplete, and existing DataScript additions are restored. Copyright text follows the original footer. Generic unavailable labels, strikethrough, candidate counts, repeated query-operation labels, local-design/runtime-identity decoration, and duplicate scope headings are removed.
