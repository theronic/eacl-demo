## Purpose

Make the default DataScript explorer available on the demo landing page while avoiding DataScript payload costs for visitors selecting server backends.

## ADDED Requirements

### Requirement: Main-page backend selection
The landing page SHALL default to DataScript when no backend is specified and SHALL honor valid explicit backend, storage, and platform URL selections. Startup, backend selection, and browser history navigation SHALL operate within the main application without a document redirect or reload.

#### Scenario: Default visit
- **WHEN** a visitor opens `/` with an enabled DataScript publication
- **THEN** DataScript SHALL load and become usable at `/` without navigating to `/datascript/`

#### Scenario: Explicit server visit
- **WHEN** a visitor opens `/?backend=datahike&storage=s3&platform=lambda-1769`
- **THEN** the explorer SHALL select that profile without initializing DataScript

#### Scenario: Backend selection and history
- **WHEN** a visitor switches between an enabled server profile and DataScript, then uses Back and Forward
- **THEN** the selected profile and canonical URL SHALL follow the navigation without a new document load

### Requirement: Conditional runtime loading
DataScript runtime code and fixture payload SHALL be fetched and initialized only after DataScript is selected. Server-profile visits SHALL NOT preload or prefetch them. Concurrent requests for the same runtime artifact SHALL share a load, and successful loads SHALL be reused within the document. The existing deployment identity handshake SHALL remain enforced.

#### Scenario: First DataScript selection
- **WHEN** a visitor selects DataScript after visiting a server profile
- **THEN** the runtime SHALL load on demand and initialize the local explorer without navigation

#### Scenario: Server-only network trace
- **WHEN** a visitor loads and uses only a server profile
- **THEN** the network trace SHALL contain no DataScript runtime or fixture request

### Requirement: Recoverable startup and isolated lifecycle
The application SHALL show browser loading status until runtime initialization completes, expose a retry for load or initialization failure, and keep backend selection available. Switching away SHALL invalidate pending results and release connection, cursor, and cache state. A released session SHALL NOT publish late results or interfere with a newer session.

#### Scenario: Retry failed load
- **WHEN** a runtime load fails and the visitor retries after the asset becomes available
- **THEN** loading SHALL be attempted again and the explorer SHALL become usable without a page reload

#### Scenario: Switch during initialization
- **WHEN** a visitor switches to a server profile while DataScript loads or initializes
- **THEN** late DataScript completion SHALL NOT replace the server UI or leave an active abandoned connection

#### Scenario: Return after release
- **WHEN** a visitor returns to DataScript after releasing its previous session
- **THEN** a fresh local session SHALL initialize using the already loaded code, without restoring additions from the released session

### Requirement: Legacy link compatibility
`/datascript` and `/datascript/` SHALL serve the shared application and canonicalize to `/` using same-document history replacement. Valid backend and portable explorer query intent SHALL be preserved; a legacy link without an explicit backend SHALL select DataScript.

#### Scenario: Existing bookmarked link
- **WHEN** a visitor opens `/datascript/?backend=datascript&storage=browser-memory&platform=browser`
- **THEN** DataScript SHALL open in the shared application and the address SHALL become the equivalent root URL without a second document request
