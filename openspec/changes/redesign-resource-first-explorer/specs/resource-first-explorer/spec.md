## Purpose

Provide a resource-first EACL demonstration that makes forward discovery, reverse discovery, permission decisions, consistency semantics, and query evidence understandable in an accessible two-column workspace.

## ADDED Requirements

### Requirement: Two-column exploration workspace
The explorer SHALL provide a large resource pane and a narrower resource access inspector on desktop. Principal selection SHALL appear in the top-right application header instead of a persistent subject-selection sidebar. At narrow widths the panes SHALL reflow into one readable column with a discoverable way to reach the updated inspector.

#### Scenario: Explorer is ready on desktop
- **WHEN** a profile has completed the existing identity-checked bootstrap
- **THEN** schema resource-type roots SHALL occupy the primary pane, resource access details SHALL occupy the right pane, and the active principal SHALL remain visible in the header

#### Scenario: Explorer is used on a phone
- **WHEN** the viewport is 390 CSS pixels wide
- **THEN** principal selection, resource navigation, consistency controls, and the access inspector SHALL be usable without horizontal page overflow or inaccessible controls

### Requirement: Principal picker preserves subject discovery
The principal picker SHALL retain quick-subject selection and known-user browsing, including exactly 25 users per known-user page, loading, empty, retry, and first/previous/next-page behavior independent of resource page size. Any local filter SHALL identify its loaded scope and MUST NOT imply unbounded server search. Changing the principal SHALL invalidate principal-scoped results and announce the new context. Existing user subject support MUST NOT be misrepresented as arbitrary group or subject-type support.

#### Scenario: User chooses a principal from a later page
- **WHEN** a visitor opens the picker, advances the known-user list, and selects a user
- **THEN** the header SHALL show that user, the picker SHALL close and restore focus to its trigger, and resource lookups SHALL restart for that principal with the existing permission and consistency intent

#### Scenario: Principal changes while lookup is pending
- **WHEN** an old principal's resource request completes after principal selection changes
- **THEN** its resources, counts, cursor, metadata, errors, and loading completion SHALL NOT populate the new principal's view

### Requirement: Resource types initiate bounded forward discovery
Every queryable resource type in the active schema SHALL have a root. Expanding a root SHALL run bounded `lookup-resources` and the existing bounded count behavior for the active principal and permission. Collapsed roots MUST NOT trigger recursive descendant loading. Exact counts, truncated lower bounds, page ranges, and pending counts SHALL remain distinguishable. A permission absent from a type SHALL produce an accurate unsupported state without manufacturing an empty successful query.

#### Scenario: Visitor expands Servers
- **WHEN** Servers is expanded with a supported permission
- **THEN** the root SHALL show its authorized page, page navigation, separate lookup/count evidence, and any truncated-count increase action within the existing count ceiling

#### Scenario: Count is bounded
- **WHEN** a response reports a truncated count of 1,000
- **THEN** the UI SHALL show a lower bound such as `1,000+` and MUST NOT represent it as an exact total or calculate a completeness percentage from it

#### Scenario: Empty and unsupported roots
- **WHEN** a type has no accessible resources or does not define the selected permission
- **THEN** the explorer SHALL distinguish a successful empty result from an unsupported permission and SHALL NOT label either as a failed network request

### Requirement: Nested traversal separates expansion and selection
Resource rows SHALL provide distinct expansion and selection actions. Square plus/minus disclosures SHALL communicate open/closed state, with an accurate leaf or unknown-child presentation. Nested relationship groups SHALL identify their target type and relation, retain the active authorization principal and permission, and paginate independently. A relationship hierarchy MUST NOT be described as an authorization explanation unless actual explanation evidence supports that claim.

#### Scenario: Expand a resource without selecting it
- **WHEN** the visitor activates a resource disclosure
- **THEN** its relationship groups SHALL open without changing the selected inspector resource

#### Scenario: Select a resource without expanding it
- **WHEN** the visitor activates a resource label
- **THEN** the inspector SHALL target that resource without implicitly expanding its descendants

#### Scenario: Cyclic or repeated relationships
- **WHEN** traversal encounters an ancestor again or an object appears through more than one path
- **THEN** ancestor cycles SHALL terminate with an explicit cycle indication, and independent non-cyclic occurrences SHALL retain path-specific expansion without duplicate appearances inflating dataset totals

### Requirement: Tree presentation preserves navigation context
The tree SHALL provide hierarchy guides, stable aligned metadata columns, a visible selection, and an independent keyboard focus indicator. Cosmetic branch state SHALL survive collapse/reopen and normal preference restoration without persisting authorization results. Filtering loaded resources SHALL retain matching ancestors, temporarily reveal relevant branches, and restore ordinary expansion when cleared. The UI MUST NOT claim that filtering loaded pages searched unloaded resources.

#### Scenario: Filter is cleared
- **WHEN** a visitor filters loaded rows and then clears the filter
- **THEN** the normal stored expansion state SHALL return, and filter-specific expansion changes SHALL NOT overwrite it

#### Scenario: Keyboard exploration
- **WHEN** the tree has keyboard focus
- **THEN** Up/Down SHALL move through visible rows, Right SHALL expand or enter a branch, Left SHALL collapse or move to its parent, Home/End SHALL reach the first/last visible row, and Enter SHALL activate selection or group expansion as appropriate

#### Scenario: Focused descendant disappears
- **WHEN** collapse, filtering, or a scoped result transition removes the focused row
- **THEN** focus SHALL move to a visible ancestor or a valid root rather than remaining on a hidden or detached node

### Requirement: Access inspector retains independent reverse lookups and decisions
The inspector SHALL identify the selected resource by type and ID, preserve its available attributes, and expose all schema-defined permission decisions and paginated `lookup-subjects` results. Each permission operation SHALL retain independent loading/error/retry and evidence. Changing the inspected permission SHALL NOT silently change the resource-discovery permission. Switching to a listed subject SHALL be an explicit labelled action.

#### Scenario: Multiple permissions exist
- **WHEN** a selected resource defines view and admin permissions
- **THEN** both independent decisions SHALL remain accessible, reverse results SHALL be available for both permissions, and failure of admin SHALL NOT overwrite view

#### Scenario: Principal changes
- **WHEN** a new principal is selected
- **THEN** the inspector SHALL clear the selection or explicitly revalidate a retained selection before presenting it as part of the new exploration, and old principal decisions SHALL not appear as current

### Requirement: Consistency remains explicit and semantically unchanged
All four named consistency modes SHALL remain directly visible above exploration, with the active mode selected and unavailable modes disabled with an adjacent reason. Mode selection MUST NOT be hidden behind a dropdown or dialog. An accessible route to full semantics SHALL remain visible. Available modes and limitations SHALL derive from the deployed descriptor. The redesign SHALL preserve minimize-latency, at-least-as-fresh, at-exact-snapshot, and fully-consistent behavior where supported, including relative/absolute freshness floors, conditional exact datetime selection, selected and served basis evidence, Re-query, Refresh Snapshot, loading, and error handling. Unsupported controls MUST NOT silently substitute another guarantee.

#### Scenario: Relative freshness floor
- **WHEN** a visitor sets an at-least-as-fresh relative floor
- **THEN** the UI SHALL explain that relative now is the selected snapshot date and SHALL preserve the existing floor movement on Refresh Snapshot

#### Scenario: Absolute freshness floor
- **WHEN** the visitor chooses an absolute datetime and then refreshes the snapshot
- **THEN** the absolute floor SHALL reset according to the existing latest-selected-snapshot behavior and the updated value SHALL be visible

#### Scenario: Exact datetime support varies
- **WHEN** a descriptor supports or rejects exact snapshot datetime selection
- **THEN** the UI SHALL respectively expose the datetime control with its at-or-before resolution semantics or display the descriptor's limitation without an enabled date editor

#### Scenario: Read-only fully-consistent limitation
- **WHEN** the descriptor cannot establish fully-consistent behavior
- **THEN** the option SHALL be unavailable with the supplied reason adjacent to the consistency controls and MUST NOT imply synchronization with an authoritative writer

#### Scenario: Re-query and Refresh Snapshot differ
- **WHEN** the visitor re-queries or refreshes a fixed snapshot profile
- **THEN** those actions SHALL remain distinct and the UI SHALL NOT imply that a new request necessarily advanced the source basis

### Requirement: Query evidence is attributable and truthful
Query latency and measured cache outcomes SHALL appear directly beside resource lookups, independent counts, permission decisions, and reverse subject lookups, not solely in activity or diagnostics. Count completeness and basis information SHALL remain attributable to the operation and context that produced them. A visible evidence summary SHALL distinguish observed hits, misses, and disabled reads from the independent cache read/populate preferences. Missing measurements SHALL remain explicitly unavailable. Any bounded query activity view SHALL hold sanitized summaries and be reset across incompatible profile/basis contexts. Existing qualified storage comparison rules SHALL continue to apply; unequal dataset sizes MUST NOT be presented as a fair backend benchmark.

#### Scenario: Cache preference is enabled
- **WHEN** the cache preference is on but a response has no cache-hit measurement
- **THEN** the explorer SHALL show the preference separately and SHALL NOT describe that response as a cache hit

#### Scenario: Timing is available
- **WHEN** a response supplies elapsed time
- **THEN** it SHALL be shown with the operation, served basis, cache metadata when present, and source context, while any client round-trip measurement SHALL carry a distinct label

### Requirement: Existing functionality remains reachable
The redesign SHALL retain backend/storage/execution selection and availability reasons, identity handshake and deployment warnings, schema visualization and supported editing, independent cache read/populate switches, cache metrics/refresh and capability-gated eviction, resource and relationship pagination/recovery, bounded counts, the standalone arbitrary permission checker, local seeding/progress/limits/retry, source links, theme preferences, canonical semantic URLs/history, and the separate local caveats/expiry playground. Unsupported server mutations MUST NOT be introduced by a more prominent control.

#### Scenario: Standalone permission check
- **WHEN** a visitor edits the standalone principal, permission, and resource controls
- **THEN** a check SHALL be possible independently of tree selection and SHALL preserve the active cache and consistency options and existing request cancellation behavior

#### Scenario: Local seeding
- **WHEN** a supporting browser profile adds resources
- **THEN** validation, advertised limits, progress, inert/busy exploration, retry, and local reset messaging SHALL remain available in the redesigned dataset controls

#### Scenario: Profile switch or browser history
- **WHEN** backend, storage, execution, or canonical history selects a different profile
- **THEN** the existing identity validation, request abortion, portable selection rules, and isolation of basis, cursor, cache, seed, and error state SHALL remain intact

### Requirement: Accessible and resilient visual system
The explorer SHALL retain the 🦅 eagle emoji logo and provide coherent green-accented light/dark treatments, resource identifiers of at least 16 CSS pixels, latency values of at least 14 CSS pixels, visible focus, sufficient text/control contrast, reduced-motion support, labelled inputs, keyboard-operable dialogs with focus restoration, and responsive layouts. Loading and retry affordances SHALL remain local to their failed operation whenever unrelated valid results can remain visible.

#### Scenario: A panel fails
- **WHEN** a reverse lookup fails while the resource page remains valid
- **THEN** its retry and error SHALL appear in the inspector without erasing or relabelling the resource page as failed

#### Scenario: Picker closes
- **WHEN** a keyboard user dismisses the principal picker with Escape or selects a principal
- **THEN** focus SHALL return to the header trigger and the changed context SHALL be announced when applicable

### Requirement: Reviewable local design preview
The proposal SHALL include a loopback-served interactive preview on a Git branch, showing light/dark treatments, principal selection, nested exploration, the access inspector, and consistency control layouts. The preview SHALL use the existing compiled DataScript runtime and canonical browser fixture for actual authorization decisions and measured latency/cache evidence. Server profiles without local connections SHALL be explicitly labelled disconnected and MUST NOT silently execute DataScript queries. The preview MUST NOT fabricate EACL performance evidence, contact production APIs, replace production entry points, or claim implementation of the preservation contract.

#### Scenario: Reviewer opens the preview
- **WHEN** the documented local preview command is running
- **THEN** the reviewer SHALL be able to exercise the primary design interactions and inspect the canonical fixture through live browser-local queries and identify which production integration behavior remains for implementation

### Requirement: Preserve the canonical stress-test schema and fixture
The redesign SHALL preserve the existing permission schema, wire schema, resource and subject identifiers, fixture generation and sizes, recursive parent chains, duplicate semantics, shared administration, and intentional cyclic relationships. It MUST NOT substitute a smaller invented dataset, rename resources for presentation, simplify permission expressions, or replace EACL decisions with a demo helper. Schema visualization SHALL retain all original definitions, relations, and permission expressions.

#### Scenario: Reviewer inspects the browser dataset
- **WHEN** the redesigned browser preview loads its canonical 10,000-resource fixture
- **THEN** it SHALL retain 80 subjects, 38,613 relationships, and the original six-definition, 13-relation, nine-permission schema with its existing digest

#### Scenario: Cyclic stress-test data is explored
- **WHEN** the original fixture includes a parent cycle
- **THEN** authorization SHALL still use the original EACL engine and schema, while the visual tree SHALL stop at repeated ancestors without deleting or rewriting the relationship

### Requirement: Backend capabilities are visible without dropdowns
The explorer SHALL show the current public backend catalog and its supported storage names without requiring a dropdown to discover them. Storage and execution choices SHALL use visible controls with active selection and unsupported reasons. Registry availability and current profile semantics SHALL remain authoritative; visible options MUST NOT imply unavailable deployments are connected.

#### Scenario: Visitor opens the default browser profile
- **WHEN** the explorer first renders its profile controls
- **THEN** DataScript, Datahike, Datomic, and Datalevin and their respective browser memory, S3/DynamoDB, DynamoDB, and embedded disk storage names SHALL be visible along with execution choices and active-profile availability
