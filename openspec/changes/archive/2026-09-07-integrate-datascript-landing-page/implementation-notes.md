# Implementation and qualification

Completed on 2026-09-07. All 15 implementation tasks are complete. No production deployment was performed.

The root SolidJS app loads the content-addressed DataScript runtime only when the browser profile is selected, restores the canonical 10,000-resource snapshot, and exposes additive browser-local seeding up to 100,000 total resources. Explicit server-profile visits do not fetch the runtime. Legacy DataScript URLs serve the same app and normalize within the document, preserving query parameters. Switching away releases local data; returning restores the initial snapshot.

Seed jobs publish atomic batches of 100 resources, yield between batches, expose committed progress, and retry only unfinished work. Additional resources use deterministic local account/server groups with bounded account fanout. This preserves the canonical initial snapshot and EACL relationship APIs while avoiding the multi-second endpoint scans observed when extending the benchmark fixture's large account groups. These additions are marked as locally modified data, not a canonical benchmark fixture extension.

## Verification

- Production browser qualification: 18 tests passed across desktop and mobile Chromium, including default root startup, legacy links, history, lazy loading and retry, stale session ownership, additive counts, authorization of new resources, invalid and overlapping jobs, partial retry, and cancellation. Local operations make no authorization or mutation API requests.
- Server-profile network isolation: 1 test passed; no DataScript assets fetched.
- Contract, explorer-state, and workflow/routing policy tests: 174 passed. Production static assembly: 1 passed.
- Fixture tests: 23 passed. Shared UI tests: 4 passed. TypeScript checking and generated-validator consistency passed.
- Bundle isolation passed: main JavaScript 602,935 bytes; conditional runtime 6,595,777 bytes.
- Two clean static builds produced identical output across 18 files under Node 25.9.0. The local build used Java 26.
- Desktop and mobile screenshots were inspected; the seed controls and limit label fit at 1,440 px and 390 px with no horizontal overflow.
- OpenSpec strict validation and Git whitespace checks passed.

## Resource-cap measurements

The production runtime added 90,000 resources to the initial 10,000. Both tests confirmed an exact final count of 100,000 and a ready job state. Measurements use Chromium on the local machine; the mobile project uses a mobile viewport, not physical mobile hardware.

| Project | Addition duration | Longest measured event-loop gap |
| --- | ---: | ---: |
| Desktop Chromium | 20.19 s | 65.7 ms |
| Mobile Chromium | 20.35 s | 63.7 ms |

The browser tests write reproducible measurement receipts to `target/verification/datascript/cap-desktop-chromium.json` and `cap-mobile-chromium.json` on each run.

Runtime SHA-256: `a6f7802da95287cde97796ab2e24c068f8264768f08d5bb4f14d4b3e8148d0df`.

EACL core revision: `a1dfc4bdd93ccefdf24da4ea51b3ed0427f7187a`.
