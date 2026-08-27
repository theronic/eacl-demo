# Workspace boundaries

`workspace-layout.json` is the machine-readable ownership map. Boundaries are intentionally one-way:

```text
apps ────────┐
services ────┼──> packages/contracts + packages/fixture-types
             ├──> profile-local implementation
apps ────────┴──> apps/explorer-main canonical components + packages/explorer-state
fixtures ───────> language-neutral generated inputs/manifests
infra ──────────> immutable artifacts/manifests, never application internals
verification ──> public contracts and deployed transports
```

- `apps/explorer-main` owns the canonical Explorer component tree, exact stylesheet, and server-profile static entry.
- `apps/explorer-datascript` owns only the separate DataScript build entry and direct browser-runtime wiring; it imports the canonical main components and stylesheet, while its ClojureScript/DataScript dependency graph cannot be reached from the main entry.
- `packages/contracts` owns closed `explorer.v1` transport/logical shapes and validation.
- `packages/explorer-state` owns selector, URL, request epoch, cancellation, and mixed-generation state.
- `packages/ui` retains backend-neutral contract-era components and tests, but no deployed Explorer entry imports it; the one canonical deployed presentation lives under `apps/explorer-main/src`.
- `packages/fixture-types` owns language-neutral fixture/manifest types; `fixtures` owns generator inputs and generated golden data.
- Each `services/*` directory owns exactly one composite profile and may not import another profile service.
- Infrastructure is split into shared foundation/static, one runtime unit per profile, one data unit per durable generation, observability, and legacy compatibility.
- `verification` consumes only public contracts/transports plus declared evidence hooks. It cannot become an ordinary deployment prerequisite except for the bounded smoke subset.

EACL Core and the maintained Datalevin fork remain immutable dependencies. Sibling working trees are never application package roots.
