# Explorer state

Backend/storage selection, capability projection, portable URL/history state, monotonically increasing client epochs, cancellation, stale-response suppression, and independently settled panel state.

`src/explorer-controller.mjs` is framework-neutral. It owns a selected profile transport, validates the descriptor mapping/capabilities, isolates async state per stable panel ID, retains settled sibling data on failure, and releases each replaced transport exactly once. UI components subscribe to snapshots; they do not own backend lifecycles.

`support/mock-transports.mjs` contains deterministic UI qualification fixtures for all six profile capability combinations. They are never registry entries or deployable substitute backends.

`src/descriptor-presentation.mjs` projects the closed descriptor vocabulary into user-facing operation, consistency, snapshot, cache, mutation, limitation, runtime, and control text. Its dictionaries are keyed only by descriptor terms; changing a backend name cannot change the projected behavior.

`src/explorer-operations.mjs` is the backend-neutral bounded workflow layer. It creates only closed `explorer.v1` inputs, owns subject/relationship/reverse cursor stacks per client epoch, caps page sizes and escalating counts, scopes independent permission panels, and rejects malformed page/count/decision results before derived state changes.

`src/ui-preferences.mjs` persists one bounded product-neutral preference record and applies system/light/dark themes. `src/focus-management.mjs` moves focus only for the current request in the current profile epoch and falls back to a stable panel heading when a transient result target disappeared.
