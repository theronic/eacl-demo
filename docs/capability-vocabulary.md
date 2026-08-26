# Capability vocabulary

`packages/contracts/capability-vocabulary.v1.json` is the closed vocabulary used by profile descriptors, API envelopes, registry entries, and UI presentation. It separates logical operations, requested consistency, snapshot lifetime, cache scope, mutation locality, bounded limit names, dataset identity, and limitations.

The lists are values, not promises. A profile descriptor selects only terms that passed qualification and states unsupported consistency or operations explicitly. In particular, Datomic's `fixed-environment` snapshot cannot be rendered as exact/history support; browser-worker state cannot be rendered as durable; and Jank's Datomic-like store must carry `datomic-like-not-datomic-pro`, `no-durability`, and `no-snapstart` where applicable.

Unknown terms are rejected at runtime until a contract revision adds them. The presentation layer uses descriptor values and human-readable explanations, never backend-name tests, to decide which panels and controls to expose.
