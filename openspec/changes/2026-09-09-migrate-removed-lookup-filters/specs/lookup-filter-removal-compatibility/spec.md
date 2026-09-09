## ADDED Requirements

### Requirement: Nested requests preserve authorization
Nested branches SHALL use indexed `read-relationships` with exact parent type/id,
child resource type, relation and complete authorization on the resource endpoint.
They SHALL retain consistency/cache settings and SHALL NOT use removed lookup
filters, per-row public checks or complete fixture materialization.

#### Scenario: Incomplete authorization
- **WHEN** a wire request has partial authorization or omits its resource type
- **THEN** admission fails before backend execution without a raw fallback

### Requirement: Obsolete lookup fields fail closed
Browser, JVM and Jank entry points SHALL reject obsolete lookup relationship
fields by presence, including partial, nil and malformed values.

#### Scenario: Old browser sends relationship lookup fields
- **WHEN** an old request reaches the migrated service
- **THEN** it receives an explicit validation failure, never broader results

### Requirement: Page state preserves bounded progress and user inputs
The demo SHALL propagate bounded metadata and opaque cursors through all layers,
keep Next on empty bounded pages, calculate ranges from accepted rows, and keep
query latency/cache badges next to their results. Root counts SHALL NOT be labeled
as branch counts. Recovery SHALL preserve selected inputs and discard stale responses.

#### Scenario: Empty intermediate window
- **WHEN** EACL returns no rows with bounded progress and a cursor
- **THEN** Next resumes that cursor and later rows are neither skipped nor duplicated

### Requirement: Fixture assumptions are verified before serving
Generation, seed and artifact qualification SHALL verify unqualified unique
endpoint mapping, including large fixtures and larger browser seeds. Serving a
page SHALL NOT perform a complete relationship scan to validate the fixture.

#### Scenario: Qualified or duplicate fixture relationship
- **WHEN** an artifact violates the required mapping
- **THEN** qualification fails rather than claiming lookup-equivalent object pages

### Requirement: Packaged consumer adoption is qualified
Adoption SHALL record compatible browser, JVM, Jank and core versions and verify
mixed-version admission/cursor recovery. Performance evidence SHALL use predeclared
budgets and report candidate/backend work alongside latency with isolated foreground
lookahead and separate background verification.

#### Scenario: Jank still emits a removed filter
- **WHEN** packaged verification executes its fixture exemplar
- **THEN** release adoption fails until that consumer uses supported APIs
