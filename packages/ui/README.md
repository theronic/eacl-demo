# Shared UI

Backend-neutral accessible SolidJS explorer components. Capabilities and limitations come from descriptors, never backend-name conditionals.

`src/components.tsx` exports the shared header, two-step selector, profile status, panel boundary, loading/error/empty states, bounded live announcer, cursor pagination, subject and permission selection, object list/detail, relationship list, authorization result, schema view, cache view, consistency selector, limitation list, and immutable metadata view. `src/types.ts` mirrors normalized `explorer.v1` presentation data without importing a backend adapter.

The shared stylesheet provides one semantic class system, keyboard focus, responsive reflow, and reduced-motion handling. Applications may provide theme tokens but must not fork component markup by backend.

`npm run test:ui` renders component states through Solid's server renderer and checks selector availability, live/status/error semantics, durable focus targets, and descriptor-projected consistency/limitation text. The framework-neutral state suite separately covers capability combinations, unavailable profiles, boundary validation failures, stale responses, and selector/history changes.
