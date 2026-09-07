# datascript-local-seeding Specification

## Purpose

Provide an immediately populated browser-local DataScript demo and let visitors add data with accurate progress and consistent explorer results.

## Requirements

### Requirement: Automatic canonical initial dataset
Each fresh DataScript session SHALL automatically restore the canonical 10,000-resource dataset with its supporting subjects and relationships, exactly once before becoming ready. Initial restoration SHALL preserve the canonical fixture identity and SHALL NOT report synthetic transaction progress.

#### Scenario: Fresh session is ready
- **WHEN** DataScript first becomes ready after selection or reload
- **THEN** it SHALL expose 10,000 logical resources and canonical authorization results without requiring a seed action

### Requirement: Additive local seeding
The ready DataScript explorer SHALL provide a labeled additional-resource count and a seed action. It SHALL accept positive safe integers within a displayed browser resource limit and reject invalid or over-limit input before mutation. Successful seeding SHALL append the requested number of resources and required relationships with unique identities, preserving existing data. Seeding and authorization SHALL execute locally without server API calls or workers. Server profiles SHALL NOT gain a public seed operation.

#### Scenario: Add more resources twice
- **WHEN** a visitor adds 1,000 resources and then adds 500 resources to a fresh session
- **THEN** the dataset SHALL contain 11,500 logical resources with unique identities and valid authorization relationships

#### Scenario: Invalid input
- **WHEN** a visitor submits a nonpositive, fractional, unsafe, or over-limit resource count
- **THEN** the UI SHALL explain the validation error and the dataset SHALL remain unchanged

#### Scenario: Server backend
- **WHEN** a visitor selects a read-only server profile
- **THEN** local seeding controls SHALL be unavailable and no seed request SHALL be sent to that server

### Requirement: Accurate progress and failure recovery
Seeding SHALL report committed progress, prevent overlapping seed jobs, and yield sufficiently for status rendering and backend switching. On failure, the UI SHALL report the error and the actual committed resource count. Retrying SHALL NOT duplicate previously committed resources. Releasing the profile SHALL stop further seed commits and discard late progress.

#### Scenario: Job already active
- **WHEN** a seed job is running
- **THEN** a second submission SHALL NOT start another job and progress SHALL reflect completed commits

#### Scenario: Failure after partial progress
- **WHEN** a seed job fails after committing some batches
- **THEN** the explorer SHALL retain a consistent committed dataset and retry SHALL complete only the remaining requested additions

#### Scenario: Leave during seeding
- **WHEN** a visitor switches away while a seed job is running
- **THEN** no subsequent batch SHALL commit to the released session and its progress SHALL NOT update the selected backend

### Requirement: Consistent explorer state after additions
Each committed seed batch SHALL update resource indexes and dataset counts consistently with the local database. Completed or failed seeding SHALL refresh the explorer against its current basis and invalidate obsolete cursors, pages, and authorization cache results. The UI SHALL distinguish the modified local dataset from the pristine canonical fixture without altering immutable deployment identity.

#### Scenario: Explore new data
- **WHEN** seeding completes
- **THEN** added resources SHALL be discoverable through shared explorer operations, permission checks SHALL use their relationships, and displayed counts SHALL match the committed dataset

#### Scenario: Obsolete cursor
- **WHEN** a cursor from before a seed mutation is submitted afterward
- **THEN** it SHALL be rejected as stale rather than silently paging across dataset revisions
