## Purpose

Define an EACL v8 DataScript explorer that runs entirely in a browser worker while sharing the canonical SolidJS presentation.

## ADDED Requirements

### Requirement: EACL v8 DataScript implementation
The browser profile SHALL use the current EACL v8 core and `eacl-datascript` ClojureScript adapter from the recorded source stack with DataScript. It MUST NOT use the legacy EACL v7 commit, Rum application, or a server-side substitute while labeling itself v8 DataScript.

#### Scenario: Provenance is displayed
- **WHEN** the DataScript bootstrap completes
- **THEN** the descriptor SHALL report EACL v8 source identity, DataScript adapter/runtime versions, fixture digest, artifact digest, and browser-worker execution

### Requirement: Browser-only authorization and data
The DataScript connection, EACL client, selected immutable database value, caches, cursor lifecycle, and authorization operations SHALL remain inside the browser worker. Other than static asset retrieval and optional non-sensitive telemetry explicitly approved by policy, authorization inputs and results MUST NOT be sent to a server.

#### Scenario: User evaluates a permission
- **WHEN** the user runs `check-permission` in `/datascript/`
- **THEN** the worker SHALL perform the complete EACL operation locally and the network log SHALL show no authorization API request

### Requirement: Separate artifact boundary
The DataScript application SHALL be served at `/datascript/` as a separate HTML/build entry. Its ClojureScript runtime, EACL DataScript adapter, DataScript library, worker, and seed artifact MUST NOT appear in the main explorer's entry graph or be fetched during server-profile use.

#### Scenario: Bundle audit runs
- **WHEN** production assets are built
- **THEN** an automated graph and network-load test SHALL prove the forbidden DataScript dependencies are reachable only from the `/datascript/` entry

### Requirement: Shared presentation and logical contract
The DataScript entry SHALL reuse the common explorer UI/state/contract packages and SHALL implement the `explorer.v1` logical operation shapes over structured worker messages. DataScript-specific behavior SHALL be represented through capabilities rather than a forked set of presentation components.

#### Scenario: Resource is selected locally
- **WHEN** a user selects a resource in the DataScript explorer
- **THEN** the same shared resource tree, schema, subjects, reverse lookup, bounded count, and permission detail components SHALL render the normalized worker responses

### Requirement: Deterministic 10,000-resource default fixture
On first readiness the worker SHALL build exactly 10,000 resources from the canonical small fixture with stable logical IDs, schema digest, relationship invariants, and exemplar decisions. Progress SHALL be observable and cancellable/restartable at the UI state boundary.

#### Scenario: Worker is recreated
- **WHEN** the page is reloaded or the worker is terminated and restarted
- **THEN** it SHALL produce the same fixture digest and logical results without relying on server state

### Requirement: Honest DataScript consistency behavior
The profile SHALL advertise only the current EACL v8 DataScript adapter's certified local consistency modes. It SHALL not advertise external replication, retained historical DB selection, or exact historical replay. Unsupported exact requests SHALL fail before cache or traversal work.

#### Scenario: Exact historical mode is requested manually
- **WHEN** a crafted worker message requests unsupported exact history
- **THEN** the worker SHALL return a typed unsupported-consistency error and SHALL not evaluate at the current connection head

### Requirement: Worker request isolation and bounded messages
Every worker request and response SHALL carry a request ID and client epoch and SHALL obey closed shapes and size/limit validation. Navigating away, switching profile, or resetting the worker SHALL invalidate late replies and release worker-owned state.

#### Scenario: Synchronous scan finishes after reset
- **WHEN** a non-preemptible DataScript operation completes after the UI has reset the worker epoch
- **THEN** its reply SHALL be discarded and SHALL not repopulate the new fixture's UI state

### Requirement: Local reset and seed controls are explicit
The DataScript profile MAY expose reset or supported-size reseed controls only as `localMutation` capabilities. The UI SHALL label that the effect is limited to browser memory and SHALL never present it as a write to a shared demo backend.

#### Scenario: User resets the browser database
- **WHEN** the local reset action is confirmed
- **THEN** only the current worker's database, basis, cursors, caches, and derived UI state SHALL be replaced and server profiles SHALL remain unaffected
