# Explorer browser and accessibility qualification

These browser and accessibility suites are deliberately outside the ordinary `main` push workflow. Run them locally with the commands below when changing the explorer. They do not block or trigger normal demo deployment.

The Playwright projects cover desktop Chromium, Firefox, and WebKit plus emulated Pixel 7 Chromium and iPhone 15 WebKit. The suite checks the two-step selector and canonical URL transition, keyboard focus visibility, console errors, viewport overflow, persistent explicit theme selection, reduced-motion behavior, and an axe scan using WCAG 2/2.1/2.2 A/AA tags. It also publishes a content-addressed enabled server profile into the isolated browser test, intercepts only that profile's canonical API path, validates the immutable descriptor/envelope handshake, opens the subject/schema/cache/count panels, and executes an authorization decision with exact request-ID and POST-payload-hash assertions. The normal test fixture publishes all six non-enabled status records plus an empty benchmark index, matching the production rule that a known disabled profile is data rather than an expected 404. Automated axe scans detect only a subset of accessibility failures, so qualification evidence also records a manual pass for headings/landmarks, labels/descriptions, keyboard order, zoom/reflow, high contrast, live announcements, startup cancel/retry, panel failure isolation, and screen-reader output.

The separate DataScript Chromium qualification publishes an enabled test-only DataScript profile bound to the compiled direct-runtime digest and locked Core SHA. It verifies the targeted publication, content-addressed static runtime, direct page initialization, and the reported demo/Core/artifact/data/basis facts. It also asserts that the page creates zero Web Workers. After readiness it clears the request log, then exercises subjects, object lookup, outbound and reverse traversal, pagination controls, schema, cache, and allowed/denied authorization through the shared explorer. Every post-readiness operation must remain inside the page runtime and produce no network request.

Local qualification uses the production build and Vite preview:

```sh
npm run build:explorer-main
npx playwright install chromium firefox webkit
npm run qualify:explorer
npm run build:static-site
npx playwright test --config verification/datascript/playwright.config.ts
```

To qualify a staged deployment instead, set `EACL_QUALIFICATION_BASE_URL` to an exact HTTPS staging origin. Do not point the suite at a mutable production alias and describe the result as qualification of an artifact unless the report also binds the returned demo SHA, Core SHA, artifact digest, deployment ID, profile descriptor identities, and static asset manifest.

Required retained evidence is the test command/tool versions, project/device matrix, exact base URL and deployment identities, Playwright HTML report, traces/screenshots/video for failures, axe JSON, manual checklist result, date, and reviewer. A failure leaves the candidate unqualified; it does not disable an already healthy independent profile or roll back siblings.

`verification/explorer/local-shell-result-2026-08-25.json` records the first clean five-project automated run under the pinned Node runtime. It is explicitly local prequalification, not release qualification: the working tree has no immutable deployed identity and the manual assessment has not yet run.
