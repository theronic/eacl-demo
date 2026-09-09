## Purpose

Make nested resource expansion a direct, paginated view of stored relationships with query-local performance evidence, while keeping permission discovery and checks in their existing dedicated operations.

## ADDED Requirements

### Requirement: Nested branches read direct relationships
Nested expansion SHALL request `read-relationships` anchored by the parent subject type/id, child resource type and relation. The branch SHALL display direct matching resource endpoints independently of the View As subject and selected permission. It MUST NOT attach `:authorization`, substitute `lookup-resources`, perform point/bulk checks for branch filtering or special-case super-user. This requirement supersedes `Nested authorization uses EACL relationship reads` in `redesign-resource-first-explorer` and the authorized nested-read clauses of `2026-09-09-migrate-removed-lookup-filters`.

#### Scenario: Platform accounts page
- **WHEN** the user expands Platforms > platform > Accounts or requests its next page of 25
- **THEN** one foreground nested request reads the anchored relationship page
- **AND** the branch performs zero endpoint permission evaluations or companion permission requests

#### Scenario: Viewing subject cannot access a related object
- **WHEN** an expanded direct branch contains an object denied to the viewing subject
- **THEN** the object remains visible as a stored relationship endpoint
- **AND** the separate permission panes retain their correct denial/access results
- **AND** the branch does not label relationship membership as a permission grant

### Requirement: Removed wire fields fail explicitly
All browser and service relationship-read admissions SHALL reject the presence of `authorizationSubject`, `authorizationSubjectType`, `authorizationSubjectId`, a relationship-read `permission`, or a direct `authorization` clause wherever those request shapes are admitted. Partial, empty and null-valued forms SHALL fail with the existing validation error. The parent `subjectType` and `subjectId` filters remain supported. Other operations SHALL retain their permission and subject fields.

#### Scenario: Old client sends an authorized relationship read
- **WHEN** an old browser submits any removed authorization field to an updated relationship endpoint
- **THEN** validation fails before invoking EACL, and the service does not silently produce a broader page

#### Scenario: New request uses an older compatible service
- **WHEN** the new demo sends a plain anchored request to a service that already supports plain relationship reads
- **THEN** the service returns the ordinary relationship page without an authorization clause

### Requirement: Nested query dependencies match the direct read
Nested request identity SHALL include only answer-affecting profile, parent/edge filters, page demand/cursor, snapshot/consistency and cache controls, plus explicit re-query/refresh intent. A viewing subject or permission change alone SHALL NOT rerun an otherwise unchanged mounted direct branch or reset its pagination. Sibling disclosure state SHALL NOT invalidate the branch. Root membership changes can remove unavailable roots through existing lookup behavior. Selection and viewport position SHALL be preserved.

#### Scenario: Permission changes with branch still mounted
- **WHEN** view changes to admin and the parent branch remains mounted at the same basis
- **THEN** permission-dependent queries update but the unchanged direct relationship request and its cursor do not reset

#### Scenario: Sibling expands
- **WHEN** a sibling node expands or collapses
- **THEN** no unrelated direct branch, lookup, count or inspector request reruns

#### Scenario: User requests fresh query evidence
- **WHEN** Re-query is clicked
- **THEN** every currently expanded branch reruns its page request under the selected controls
- **AND** Refresh Snapshot reruns relevant queries after selecting its new basis

### Requirement: Pagination and performance evidence describe the returned page
Nested pages SHALL use native opaque cursors and preserve First/Prev/Next, page size, continuation/error behavior and range labels based on returned rows. They SHALL display `read-relationships` and the measured latency/cache badge next to that query. They MUST NOT scan all relationships to calculate a branch total or reuse a root authorization count as a branch total. Button positions, selection and scroll position SHALL remain stable between pages. The approved layout and existing navbar inventory counts SHALL remain unchanged.

#### Scenario: Page transitions
- **WHEN** the user moves from the first 25-row page to the second
- **THEN** the range shows 26–50 if 25 further rows are returned and native continuation indicates whether another page exists
- **AND** timing updates do not move the pagination controls or viewport

#### Scenario: Obsolete authorized cursor
- **WHEN** an incompatible authorized-read cursor survives a version change
- **THEN** it is not reused as a direct-read cursor; the UI follows explicit pagination reset/recovery behavior without losing subject, permission or selected resource inputs

### Requirement: Authorization demonstrations and fixture remain intact
Root resource discovery/counts, lookup-subjects and Check Permission SHALL retain their existing selected-subject/permission behavior, consistency semantics and cache controls. The schema source, deduced types, fixture shape, seeding behavior and approved design SHALL remain unchanged. No banned relation or new fixture data SHALL be introduced for this removal.

#### Scenario: Ordinary user performs a check
- **WHEN** an ordinary user selects a resource and changes check inputs
- **THEN** Check Permission and subject discovery use the unchanged schema and produce their existing authorization results
- **AND** direct tree membership is not substituted for the permission decision
