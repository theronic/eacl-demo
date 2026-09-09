## 1. Proposal and local design study

- [x] 1.1 Inspect current explorer capabilities and 0tx/Peach/eDrive reference code; verify that `design.md` records source references and a feature-preservation map.
- [x] 1.2 Create a separate Git branch and isolated local interaction preview; verify the canonical DataScript build and `node scripts/preview-explorer-design.mjs` serve digest-checked runtime/metadata and allowlisted assets on loopback while production entry points are unchanged.
- [x] 1.3 Verify the revised preview's light/dark and narrow layouts, readable tree/timing typography, eight canonical decision exemplars, real lookup counts, cycles, cursor paging, principal switching, measured cache hit/miss/disabled outcomes, stable native-radio profile rows, compact consistency controls, and adjacent prominent counts/timings; record observed results and connected integration limitations in `docs/design-preview/README.md`.

- [x] 1.4 Apply the 2026-09-09 preview corrections: compact navbar/collapsible controls, typed View As, document-flow tree with branch pagination, floating typed checker/autocomplete, informative disabled states and combined timing badges, original copyright, and real DataScript additions; verify responsive layouts, counts, query semantics, and seeding reset.

- [x] 1.5 Revise the local preview controls: rightmost View As/theme order, navbar Seed Data without inventory timings, neutral/plain radio styling, source-first schema, reactive checker, larger controls, icon selection, progress with enabled backend switching, and retained scroll offsets; verify browser behavior and existing contract/selector tests.

## 2. Shared shell and principal selection

- [x] 2.1 Reconcile the preservation map against current source and the active consolidation change before implementation; verify every existing control has a named destination and no unrelated active artifact is overwritten.
- [x] 2.2 Retain the 🦅 eagle logo, EACL Explorer title and user-supplied factual Situated ReBAC subtitle, and introduce shared green color, spacing, focus, and row-density styles with at least 16px resource identifiers and 14px timings; verify light/dark screenshots and computed contrast for normal, selected, disabled, and error states.
- [x] 2.3 Extract quick users and typed subject browsing into the fixed-height top-right View As picker; verify 25-user pagination, error/retry, quick selection, Escape, focus restoration, and independence from resource page size.
- [x] 2.4 Convert the connected shell to two desktop columns and a narrow stacked layout; verify the active principal stays visible and the updated inspector is reachable on a 390px viewport without page overflow.
- [x] 2.5 Wire picker transitions through existing state setters and revalidate inspector selection; verify pending old-principal results cannot repopulate pages, counts, decisions, metadata, or errors after a switch.

- [x] 2.6 Retain the original native-radio profile selector in separate stable Backend, Storage, and Execution rows; show backend names only, reuse compatible-choice/default semantics, and verify row positions, informative disabled reasons without strikethrough, keyboard behavior, and identity validation.

## 3. Resource tree

- [x] 3.1 Extract square disclosure and resource-row presentation around existing query controllers; verify expanding a resource does not select it and selecting its label does not expand it.
- [x] 3.2 Render schema-derived type roots and lazy relationship groups with named relations; verify emitted requests retain principal, permission, page size, cache options, consistency, and basis scope.
- [x] 3.3 Preserve bounded counts, escalation, separate count/page timing, and exact/lower-bound display; verify truncated `1,000+`, observed-range correction, empty results, unsupported permissions, and count failure independently of page success.
- [x] 3.4 Preserve first/previous/next resource and relation pagination plus existing cursor recovery; verify page-size changes restart pagination and invalid/expired cursors cannot be reused across scopes.
- [x] 3.5 Introduce bounded path-specific expansion keys and preserve cycle termination; verify the same resource through two paths expands independently while ancestor cycles stop explicitly.
- [x] 3.6 Implement visible-row keyboard navigation and collapse focus repair; verify Up/Down/Left/Right/Home/End/Enter only reach visible rows and collapsed descendants cannot retain focus.
- [x] 3.7 Exclude invented text filters and query-activity dashboards; verify the original paginated resource and known-user navigation remain intact and the interface implies no new EACL search capability.

## 4. Access inspector and permission checker

- [x] 4.1 Move resource identity, full attributes, and per-permission decisions into the access inspector; verify every schema-defined permission retains independent result, loading, retry, and metadata.
- [x] 4.2 Adapt reverse subject lookup presentation without removing its pagination; verify inspected-permission changes do not alter the tree permission and one permission failure does not overwrite another.
- [x] 4.3 Add explicit View As actions and a reachable mobile inspector target; verify principal transitions clear the old selection and keyboard focus moves to a valid visible target.
- [x] 4.4 Restyle the standalone permission checker as a collapsible floating footer with typed Subject/Resource groups and discovered-ID autocomplete while retaining independent typed inputs and request behavior; verify arbitrary supported checks use active cache/consistency and input changes cannot leave a stale result labelled current.

## 5. Consistency and retained tools

- [x] 5.1 Retain all four modes in a compact native-radio row, with informative disabled states/reasons and inline reasons without a Semantics dialog; verify all advertised modes and unsupported reasons derive from the active descriptor.
- [x] 5.2 Preserve relative and absolute freshness-floor controls and exact datetime selection; verify selected-snapshot-relative now, absolute-floor refresh reset, at-or-before resolution, and unsupported date limitations against existing state tests and a supporting local profile.
- [x] 5.3 Preserve separate Re-query and Refresh Snapshot behavior with loading/errors; verify a fixed snapshot can remain unchanged and prior-basis results/cursors cannot become current after a transition.
- [x] 5.4 Preserve the complete original schema visualization and relocate detailed cache diagnostics while keeping read/populate switches accessible and each query’s measured cache outcome beside its result; verify schema expressions/toggles, independent cache read/populate switches, captured metrics/refresh, and capability-gated eviction remain accessible.
- [x] 5.5 Relocate dataset/seeding controls and retain status banners; verify uncapped positive-safe-integer validation, progress, retry, inert/busy exploration, and reset messaging, while read-only profiles gain no mutation route.
- [x] 5.6 Preserve startup/deployment/profile availability and footer identity surfaces; verify actual startup status, descriptor/registry identity rejection, source links, and conditional DataScript loading through existing qualification cases.

## 6. Evidence, regression qualification, and delivery

- [x] 6.1 Place each page count, total count, permission decision, and reverse result directly beside its own latency/cache metadata; verify no dedicated timing column or global evidence/activity summary exists, queried counts remain visible after collapse, and served basis/scope remain attributable.
- [x] 6.2 Preserve qualified storage comparison rules and explicitly unavailable metrics; verify a cache-enabled preference cannot display as a cache hit and unequal dataset sizes cannot produce a fastest-backend claim.
- [x] 6.3 Run `npm run test:explorer-state`, `npm run test:contracts`, `npm run test:ui`, and `npm run test:ui-parity` after connected changes; resolve regressions and record commands/results.
- [x] 6.4 Run the applicable explorer/browser qualification and accessibility scenarios, including pending principal/profile/basis switches, page failures, modal focus, reduced motion, and phone/tablet/desktop widths; record observed results and any unavailable environments without claiming substituted coverage.
- [x] 6.5 Verify canonical URL/history isolation and the independent local caveats/expiry playground still work; run relevant existing tests and, for Clojure changes if any, use the installed nREPL workflow with reloaded namespaces.
- [x] 6.6 Run `npm run build:explorer-main` and the relevant DataScript isolation check; update the user guide and finalize the feature-preservation map with evidence for every row.
- [x] 6.7 Present the connected local demo and final diff for review; verify canonical fixture/schema files and identifiers remain unchanged and no alternative decision helper is imported into production builds and leave deployment to the repository's ordinary delivery workflow.

- [x] 6.8 Verify fixture/schema integrity: unchanged canonical schema digest, generator/manifests/exemplars and identifiers, all original stress-test relations/expressions/cycles, and the existing canonical decision, lookup, reverse, count and pagination regressions.

Validation evidence and the production profile-release behavior are recorded in design.md. Deployment verification is tracked in the release follow-up below.

## 7. Production Release

- [ ] 7.1 Commit/push, merge through main into production, verify the published shared site and each ordinary deployment job, and notify the user.
