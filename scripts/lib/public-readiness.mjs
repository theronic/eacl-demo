import { validateDemoSmokeEnvelope } from "./demo-smoke-result.mjs";

export async function smokeFunctionUrl(profileId, origin, expectedIdentity, {
  timeoutMs = 180_000,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetchResponse = fetch,
  whileWaiting = null
} = {}) {
  const url = new URL("/health", origin);
  // SSM can spend several minutes downloading, loading the JVM and preparing
  // a fresh fixture on the shared host. Fast cached 504s must not consume the
  // readiness budget before that command finishes. Bound elapsed time instead.
  const deadline = now() + timeoutMs;
  let observed = null;
  for (let attempt = 1; now() < deadline; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),
      Math.max(1, Math.min(10_000, deadline - now())));
    try {
      const response = await fetchResponse(url, {
        method: "GET",
        headers: { accept: "application/json", origin: "https://demo.eacl.dev",
          "x-eacl-request-id": `ci-function-url-${expectedIdentity.demoSha.slice(0, 12)}-${attempt}` },
        redirect: "manual",
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type");
      observed = { status: response.status, contentType };
      const body = await response.text();
      if (contentType?.startsWith("application/json")) {
        const envelope = validateDemoSmokeEnvelope(JSON.parse(body));
        observed.identity = envelope.data?.identity ?? null;
        if (response.status === 200 && response.headers.get("access-control-allow-origin") ===
            "https://demo.eacl.dev" && response.headers.get("content-type")?.startsWith("application/json") &&
            envelope.data?.ready === true && envelope.data?.identity?.profileId === profileId &&
            envelope.data?.identity?.demoSha === expectedIdentity.demoSha &&
            envelope.data?.identity?.eaclSha === expectedIdentity.eaclSha &&
            envelope.data?.identity?.artifactSha256 === expectedIdentity.artifactSha256 &&
            envelope.data?.identity?.deploymentId === expectedIdentity.deploymentId) {
          return;
        }
      }
    } catch (error) {
      observed = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
    // The caller can learn before this deadline that the identity will never
    // appear, as an EC2 release does once its host command has failed. It
    // says so by throwing. It is asked after each attempt that did not find
    // the identity and once more when the time is up, so the identity alone
    // decides success and a failure in the last seconds is still reported.
    if (whileWaiting !== null) await whileWaiting({ final: false });
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(2_000, remaining));
  }
  if (whileWaiting !== null) await whileWaiting({ final: true });
  throw new Error(`${profileId} public origin smoke failed after deployment propagation: ${JSON.stringify(observed)}`);
}
