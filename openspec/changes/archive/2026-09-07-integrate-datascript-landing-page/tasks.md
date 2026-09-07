## 1. Conditional runtime loading and navigation

- [x] 1.1 Add content-addressed runtime metadata and a selection-triggered script loader with shared load promises and retry; verify duplicate loads, missing exports, and failed-load retry with loader tests.
- [x] 1.2 Replace entry-specific redirects in the shared App with same-document profile transitions and loading/error/retry presentation; verify root default selection, explicit server URL selection, and Back/Forward behavior.
- [x] 1.3 Make runtime initialization and transport release generation-aware while retaining the deployment handshake; verify late initialization and old-session release cannot overwrite a newer activation, and mismatched identity remains rejected.

## 2. Browser-local seed runtime and contracts

- [x] 2.1 Define browser-local seed start/status/retry and modified-dataset contracts, including the displayed 100,000-resource total limit; regenerate relevant validators and verify local acceptance plus continued server-operation rejection.
- [x] 2.2 Generate deterministic local account/server groups from the current resource ordinal and apply bounded, yielding DataScript batches; verify initial 10,000-resource restoration and successive additions of 1,000 and 500 with unique IDs and valid relationships.
- [x] 2.3 Track committed progress, original job targets, failure/resume state, and session cancellation; verify invalid inputs mutate nothing, overlapping jobs are rejected, partial failure resumes without duplication, and release prevents later commits.
- [x] 2.4 Update database-adjacent lookup collections, live counts, basis, cursor validity, and authorization cache state with each batch; verify new resources can be found and authorized, obsolete cursors fail, and immutable release identity stays unchanged.

## 3. Shared explorer seeding experience

- [x] 3.1 Enable seed controls only through the DataScript local capability and label the input as additional resources; verify validation, advertised limits, read-only server behavior, and browser-local dispatch with UI/API tests.
- [x] 3.2 Connect real seed progress and retry to shared state, remove Datahike-specific progress text, and refresh explorer views on completion or failure; verify counts and locally modified status, disabled conflicting interactions, and usable backend switching during a job.

## 4. Static delivery and planning reconciliation

- [x] 4.1 Assemble one SolidJS application with inert runtime metadata and legacy `/datascript` document aliases; retire the separate wrapper build and verify production HTML contains no eager runtime script or preload, while legacy URLs load the same app.
- [x] 4.2 Update profile route contracts, static manifests/build inventory, routing policy, determinism audits, and deployment smoke assumptions; verify existing immutable release checks and the adjusted assembly/routing tests pass.
- [x] 4.3 Update demo READMEs and reconcile the affected unarchived consolidation proposal/design/spec/task text with this change; verify no active requirement still mandates a separate DataScript app or cross-document backend switch, preserving unrelated work.

## 5. Integrated qualification

- [x] 5.1 Update and run `npm run verify:datascript-isolation` and `npm run qualify:main-network-isolation` against the production build; verify server-only visits fetch no runtime/fixture and default root visits load DataScript once without a redirect or worker.
- [x] 5.2 Extend and run `npm run qualify:datascript-browser` for root startup, legacy query preservation, switching/history, failed-load retry, additive seeding, partial retry, refreshed authorization, and switch-during-load/seed; verify all local operations make zero authorization or mutation API requests.
- [x] 5.3 Run applicable TypeScript, contract, fixture, and static determinism checks, and record browser responsiveness at the advertised resource cap; verify the resulting qualification evidence supports the conditional-loading and seeding requirements.
