# Independently callable build units

`build-units.json` is the closed registry. Every entry has an independent npm
command, while `npm run build` invokes all entries in stable lexical order. The
generic commands currently prove workspace boundaries and deterministic source
identity; their output is under
`dist/foundation-<unit>/artifact.json`. The `foundation-` target prefix is
enforced so an individual source-manifest build cannot delete a concrete
static, ZIP, JAR, native, fixture-batch, or infrastructure artifact. They do not
claim that a foundation-only unit has compiled a deployable runtime artifact.
Runtime-specific commands such as `build:static-site`,
`build:datahike-dynamodb-lambda`, `build:datomic-lambda`, and
`build:datomic-seed` produce the concrete artifacts described by their names
and have separate audits.

All units begin with `deploymentEligible: false`. A foundation-only artifact is not a deployable application or Lambda and CI must reject it at deployment. Later implementation and qualification tasks may change one unit to eligible only after it produces the required runtime-specific artifact and passes its production-path gates. This prevents a successful source-package command from masquerading as backend readiness.

`deploymentTrack` is a separate release-scope decision. `active` units gate the
eligibility of their own `ordinaryDeploymentTarget`; `parked` units remain in
the closed catalog and can still be built or qualified manually, but they
neither block nor enter ordinary deployment fan-out. A target becomes eligible
only when every active unit assigned to it is eligible. The static target thus
closes over the main entry, DataScript entry and worker, and fixtures; profile
targets qualify independently; infrastructure has no ordinary target and is
managed outside merge deployment. Jank is currently the only parked unit.
Parking does not make it deployment-eligible and does not remove its fail-closed
registry entry.

The ordinary workflow renderer validates the complete membership of every
known target, not merely the target name on one eligible unit. Unknown targets,
partial membership, a parked eligible flag, a missing deployable build, or a
missing credentialed deployment entrypoint fail closed.

Deployment-transaction implementation is also target-local. Static and the
three currently buildable JVM targets (Datahike/S3, Datahike/DynamoDB, and
Datomic/DynamoDB) have checked-in transactions, but that does not make their
units eligible. Datalevin/memory remains transaction-ineligible until its
qualified remote dependency/native closure produces a real JAR. Jank remains
parked and has no ordinary target definition.

The required units are the main explorer, isolated DataScript entry, isolated DataScript worker, five independent server-profile artifacts, fixture manifests, and infrastructure plans. Adding a runtime or static surface requires extending the closed build registry deliberately; adding it to ordinary deployment additionally requires an explicit `active` track decision.

`npm run build:static-site` is the single static deployment input. It starts the main, DataScript entry, and DataScript worker builds concurrently, waits for every constituent, and then assembles `dist/static-site` from scratch with the worker under `datascript/assets/`. Its manifest records every uploaded file, digest, byte count, and cache class. A deployment job uploads only this tree; it never synchronizes the main and DataScript prefixes independently.
Vite's internal `.vite/manifest.json` files are build evidence, not public site
objects, and are removed from the assembled deployment tree. Apart from the two
versioned HTML entry documents, every assembled file must use a content-addressed
name and the immutable cache class or the build fails.
