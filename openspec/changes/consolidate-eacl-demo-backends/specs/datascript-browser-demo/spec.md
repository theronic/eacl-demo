## Purpose

Define a simple EACL v8 DataScript explorer compiled as a static ClojureScript browser application while sharing the canonical SolidJS presentation.

## ADDED Requirements

### Requirement: Direct EACL v8 DataScript browser runtime
The browser profile SHALL use the current EACL v8 core, `eacl-datascript` ClojureScript adapter, and DataScript from the recorded source stack. It SHALL compile as a normal browser target and execute directly in the `/datascript/` page. It MUST NOT create a Web Worker, Blob worker, worker message protocol, or server-side substitute.

#### Scenario: DataScript page becomes ready
- **WHEN** `/datascript/` loads
- **THEN** the page SHALL initialize the direct ClojureScript runtime and descriptor without constructing a Worker

### Requirement: Browser-only authorization and data
The DataScript connection, EACL client, immutable database value, caches, cursor lifecycle, and authorization operations SHALL remain inside the page. Other than static asset retrieval and independently published profile status, authorization inputs and results MUST NOT be sent to a server.

#### Scenario: User evaluates a permission
- **WHEN** the user runs a permission check in `/datascript/`
- **THEN** the page runtime SHALL perform the complete EACL operation locally and the network log SHALL show no authorization API request

### Requirement: Separate static artifact boundary
The DataScript application SHALL be served at `/datascript/` as a separate HTML/build entry. Its ClojureScript runtime, EACL DataScript adapter, DataScript library, and serialized fixture SHALL be one DataScript-specific content-addressed static runtime artifact and MUST NOT appear in the main explorer entry graph or be fetched during server-profile use.

#### Scenario: Bundle audit runs
- **WHEN** production assets are built
- **THEN** automated graph and network-load tests SHALL prove that DataScript-only dependencies are reachable only from `/datascript/`

### Requirement: Shared presentation and logical operations
The DataScript entry SHALL reuse the exact common explorer components, styles, state, and compact `explorer.v1` operation envelopes. DataScript-specific behavior SHALL be represented through its descriptor rather than a forked presentation or worker protocol.

#### Scenario: Resource is selected locally
- **WHEN** a user selects a resource in the DataScript explorer
- **THEN** the same shared resource tree, schema, subjects, consistency, cache, reverse lookup, bounded count, and permission detail components SHALL render the direct runtime responses

### Requirement: Deterministic prebuilt fixture
The build SHALL produce a serialized DataScript database for the canonical 10,000-resource fixture and embed it in the content-addressed runtime. Page startup SHALL restore that database directly and MUST NOT display synthetic seeding progress or claim that a Lambda is starting.

#### Scenario: Page is reloaded
- **WHEN** the DataScript page is reloaded
- **THEN** it SHALL restore the same fixture digest and logical results without worker startup, server state, or browser-time fixture replay

### Requirement: Honest page-local lifecycle
The profile SHALL advertise browser execution, page-local snapshot/cache lifecycle, browser-local initialization, and only the DataScript adapter's supported consistency modes. Unsupported exact or externally synchronized requests SHALL return a typed unsupported-consistency failure before cache or traversal work.

#### Scenario: Exact historical mode is requested manually
- **WHEN** the direct runtime receives unsupported exact history
- **THEN** it SHALL return the same compact typed failure envelope used by server backends and SHALL not evaluate at the current connection head

### Requirement: Page cleanup is deterministic
Navigating away or releasing the DataScript profile SHALL release the runtime reference, connection-owned state, cursors, and cache. Server profiles SHALL remain unaffected.

#### Scenario: User selects a server backend from DataScript
- **WHEN** a user selects Datahike, Datomic, or Datalevin while on `/datascript/`
- **THEN** the browser SHALL navigate to the canonical main entry for that backend and the DataScript page lifecycle SHALL end
