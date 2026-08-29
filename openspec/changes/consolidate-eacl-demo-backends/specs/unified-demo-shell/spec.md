## Purpose

Define the canonical capability-driven SolidJS explorer, its backend/storage/execution selection, and portable behavior across independently deployed EACL profiles.

## ADDED Requirements

### Requirement: Backend storage and execution are selected explicitly
`https://demo.eacl.dev/` SHALL present a backend selector, a dependent storage selector, and an execution selector when more than one deployed platform exists for that backend/storage pair. Enabled options SHALL derive from deployed profile descriptors. Backend choices SHALL be Datahike, Datomic, Datalevin, Jank, and DataScript. Storage and execution choices SHALL remain limited to their parents and MUST NOT route to an undeployed, unqualified, mock, or substitute profile.

#### Scenario: User chooses Datahike and DynamoDB
- **WHEN** the user selects Datahike and then DynamoDB
- **THEN** the explorer SHALL resolve the internal `datahike-dynamodb` profile, identity-check its descriptor, display its runtime/dataset/source facts, and route subsequent operations only to that profile

#### Scenario: Backend has one deployed storage
- **WHEN** the user selects Datomic and DynamoDB is its only deployed storage
- **THEN** DynamoDB SHALL be selected automatically and the control SHALL accurately show that there is no alternative storage in this change

#### Scenario: Backend and storage have Lambda and EC2 variants
- **WHEN** the user selects Datalevin and embedded LMDB
- **THEN** the explorer SHALL offer the separately identified Lambda and EC2 executions, clear platform-owned state on a switch, and bootstrap only the chosen execution descriptor

### Requirement: Fastest qualified storage is the backend default
For a backend with multiple enabled storage profiles, the registry SHALL select by default the storage with current passing comparable benchmark evidence. Evidence SHALL use the same backend, fixture, dataset size, region, runtime path, operation mix, cache states, concurrency, and scoring method. The UI MUST NOT claim a globally fastest backend or compare unequal dataset sizes as a storage result.

#### Scenario: Datahike storage benchmark has one winner
- **WHEN** both Datahike/S3 and Datahike/DynamoDB are qualified and the accepted benchmark identifies DynamoDB as faster
- **THEN** a fresh Datahike selection SHALL default to DynamoDB and expose the evidence timestamp/digest behind that choice

#### Scenario: Only one Datahike storage is qualified
- **WHEN** DynamoDB is unavailable or lacks comparable evidence
- **THEN** S3 SHALL remain the Datahike default without describing an untested alternative as slower

### Requirement: Capability-driven presentation
The explorer SHALL render controls and explanations from the active descriptor's declared capabilities and limits. Shared components MUST NOT infer behavior from backend-name conditionals. Unsupported mutation, consistency, snapshot, cache, pagination, or diagnostic controls SHALL be hidden or disabled with an accurate explanation.

#### Scenario: Fixed Datomic snapshot loads
- **WHEN** the Datomic descriptor advertises its fixed deployment snapshot
- **THEN** the explorer SHALL offer minimize-latency, at-least-as-fresh, at-exact-snapshot, and fully-consistent while explaining that each is bounded by the immutable deployed database value and no request observes a later live head

#### Scenario: Read-only Datahike profile loads
- **WHEN** a Datahike descriptor cannot establish an authoritative writer barrier
- **THEN** the explorer SHALL show `fully-consistent*` disabled and display a note immediately below the options explaining that the read-only Lambda can validate its captured basis but cannot coordinate with a writer to establish a newer authoritative head

### Requirement: Selection switching isolates profile-owned state
Changing either selector SHALL abort or logically invalidate prior in-flight work, clear basis-, cursor-, page-, cache-view-, seed-, and error-state owned by the old profile, and preserve only portable semantic selection and presentation preferences. A response from an earlier profile or client epoch MUST NOT update the new view.

#### Scenario: Slow response arrives after storage switch
- **WHEN** a Datahike/S3 request completes after the user switches storage to Datahike/DynamoDB
- **THEN** the explorer SHALL discard the late response and SHALL not display its data, metadata, error, cursor, or loading transition

#### Scenario: Newly selected profile is starting
- **WHEN** the user switches to a valid registered backend/storage/execution selection whose bootstrap is still pending
- **THEN** the explorer SHALL immediately show execution-aware Lambda waiting or EC2 connecting status with elapsed time and MUST NOT transiently show `The selected demo is not available.`

#### Scenario: Selected object is absent from a smaller profile
- **WHEN** a user changes from a million-resource profile with `server-900000` selected to a ten-thousand-resource profile
- **THEN** the explorer SHALL explain that the resource is outside the target dataset and fall back to a declared valid state without substituting a different resource

### Requirement: Portable canonical URL state
The explorer SHALL encode backend and storage separately in bounded canonical query parameters, together with subject type/ID, permission, selected resource type/ID, page size, cache preference, and supported consistency preference. It MUST NOT serialize composite implementation profile IDs as the only selection, cursors, exact-basis tokens, native revisions, request IDs, secrets, cache payloads, seed state, or arbitrary page offsets.

#### Scenario: Shared URL is opened directly
- **WHEN** a user opens `/?backend=datahike&storage=s3` with valid semantic query state
- **THEN** the explorer SHALL resolve the exact qualified profile, validate state against its descriptor/schema, and run the query from its first page

#### Scenario: URL requests unsupported storage
- **WHEN** a URL requests `backend=datomic&storage=s3` while no Datomic/S3 profile is deployed
- **THEN** the explorer SHALL reject or normalize the selection visibly and MUST NOT silently route to DynamoDB

### Requirement: Browser history represents meaningful navigation
Deliberate changes to backend, storage, subject, permission, selected resource, and navigational context SHALL push history entries. Canonical normalization and cosmetic preference changes SHALL replace the current entry. Back and forward navigation SHALL replay the same validated transition path as a direct URL load.

#### Scenario: User navigates back across storage profiles
- **WHEN** the user changes storage and then activates browser Back
- **THEN** the explorer SHALL restore the earlier portable selection through an isolated switch and start on its first page without reusing the later profile's basis or cursors

### Requirement: Mixed deployment generations remain usable and visible
The shell SHALL tolerate independently deployed N and N-1 compatible profile generations. It SHALL display each profile's actual EACL Core SHA, demo SHA, artifact/deployment identity, and last deployment outcome without implying a fleet-atomic rollout or that every profile currently uses the same commit.

#### Scenario: One profile fails a demos-branch deployment
- **WHEN** Datahike/DynamoDB remains on the prior healthy source pair while other profiles advance
- **THEN** the selector SHALL keep the healthy profile usable, visibly mark the failed update, and MUST NOT describe all demos as synchronized

### Requirement: Shared explorer feature set
Every profile SHALL expose advertised common components for subject selection, resource discovery, bounded counts, relationship expansion, reverse subject lookup, schema visualization, and per-permission decisions. Permission detail SHALL show allowed/denied state and elapsed/cache metadata when supplied.

#### Scenario: Resource detail opens
- **WHEN** a resource type has multiple permissions
- **THEN** each advertised permission SHALL run as an independent bounded operation and one failure SHALL not fabricate or overwrite another decision

#### Scenario: Resource page size changes
- **WHEN** the user changes the Resources page size to any supported value
- **THEN** resource requests SHALL use that value while the Subjects panel continues to request exactly 25 subjects per page

### Requirement: Separate DataScript entry and payload
`https://demo.eacl.dev/datascript/` SHALL be a distinct static entry that reuses the exact shared explorer source while loading EACL v8, the DataScript adapter, DataScript, and its direct browser runtime only from DataScript-specific artifacts. The main entry's initial/server dependency graphs MUST NOT contain those browser database artifacts.

#### Scenario: Main explorer loads
- **WHEN** a user loads `/` and uses only server profiles
- **THEN** no DataScript, EACL DataScript adapter, ClojureScript runtime, Rum, or DataScript runtime artifact SHALL be downloaded from the main build graph

#### Scenario: DataScript is selected
- **WHEN** the user selects DataScript
- **THEN** the browser SHALL navigate to `/datascript/` with compatible portable intent and the entry SHALL identify browser memory as its only storage

### Requirement: Accessible resilient interaction states
The explorer SHALL meet WCAG 2.2 AA for principal flows, support keyboard navigation and visible focus, respect reduced motion, remain usable across mobile/desktop widths, and announce readiness, initialization, results, failures, and deployment lag. Loading/failure in one panel MUST NOT erase valid unrelated results.

#### Scenario: Lambda initialization is slow
- **WHEN** profile bootstrap remains pending during a cold or restore start
- **THEN** the explorer SHALL show the selected backend/storage/execution and elapsed startup state, offer cancellation/retry, and remain keyboard-operable without claiming readiness
