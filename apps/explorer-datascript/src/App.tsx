import { createSignal, onCleanup, onMount, Show } from "solid-js";

import errorCodesSchema from "../../../schemas/error-codes.v1.schema.json";
import explorerSchema from "../../../schemas/explorer.v1.schema.json";
import responseSchema from "../../../schemas/explorer-response.v1.schema.json";
import workerEventSchema from "../../../schemas/explorer-worker-event.v1.schema.json";
import availabilityData from "../../../registry/profile-registry.v1.json";
import profileData from "../../../packages/contracts/profiles.v1.json";
import { createRuntimeBoundaryValidator } from "../../../packages/contracts/src/runtime-validation.mjs";
import { createDataScriptProfileTransport } from "../../../packages/explorer-state/src/datascript-profile-transport.mjs";
import { loadProfilePublication } from "../../../packages/explorer-state/src/profile-publication.mjs";
import { createThemeController, readUiPreferences } from "../../../packages/explorer-state/src/ui-preferences.mjs";
import { ErrorState, ExplorerHeader, LoadingState, PanelBoundary, ThemeControl } from "../../../packages/ui/src/components";
import ServerExplorer, { type ExplorerProfile } from "../../explorer-main/src/ServerExplorer";

type PublicationState =
  | { phase: "loading" }
  | { phase: "ready"; profile: ExplorerProfile }
  | { phase: "error"; message: string; code: string };

const validateWorkerEvent = createRuntimeBoundaryValidator(
  { errorCodesSchema, explorerSchema, responseSchema, workerEventSchema },
  "https://demo.eacl.dev/schemas/explorer-worker-event.v1.schema.json",
  "workerEvent"
);

export default function App() {
  const initialPreferences = readUiPreferences();
  const [theme, setTheme] = createSignal<"system" | "light" | "dark">(initialPreferences.theme as "system" | "light" | "dark");
  const [publication, setPublication] = createSignal<PublicationState>({ phase: "loading" });
  const [workerProgress, setWorkerProgress] = createSignal<string | null>(null);
  let publicationController: AbortController | undefined;
  let themeController: any;

  onMount(() => {
    themeController = (createThemeController as any)({ onChange: ({ preference }: { preference: string }) => setTheme(preference as "system" | "light" | "dark") });
    void loadPublication();
  });

  onCleanup(() => {
    publicationController?.abort();
    themeController?.close();
  });

  async function loadPublication() {
    publicationController?.abort();
    publicationController = new AbortController();
    const signal = publicationController.signal;
    setPublication({ phase: "loading" });
    setWorkerProgress(null);
    try {
      const record = await loadProfilePublication({
        baseUrl: window.location.href,
        profileId: "datascript-browser-memory",
        profileDefinitions: profileData,
        baseRegistry: availabilityData,
        signal
      });
      if (signal.aborted) return;
      const profile = record.profile;
      if (profile.state !== "enabled" || !profile.deployment || profile.deployment.artifact.kind !== "browser-worker") {
        const error = new Error(profile.reason ?? "The DataScript worker is not enabled.") as Error & { code?: string };
        error.code = "profile-unavailable";
        throw error;
      }
      setPublication({ phase: "ready", profile: profile as ExplorerProfile });
    } catch (error) {
      if (signal.aborted) return;
      const failure = error as Error & { code?: string };
      setPublication({ phase: "error", message: failure.message, code: failure.code ?? "publication-invalid" });
    }
  }

  const transportFactory = (profile: ExplorerProfile) => (createDataScriptProfileTransport as any)({
    profile,
    baseUrl: window.location.href,
    profileDefinitions: profileData,
    baseRegistry: availabilityData,
    validateEvent: validateWorkerEvent,
    onProgress: (event: { message: string; completed: number; total: number }) => setWorkerProgress(`${event.message} ${event.completed.toLocaleString()}/${event.total.toLocaleString()}`)
  });

  return (
    <main>
      <ExplorerHeader
        eyebrow="EACL v8 · browser-local DataScript"
        title="Explore authorization without sending fixture data to a server."
        description="This separately loaded entry verifies a content-addressed ClojureScript worker, then keeps its DataScript database, EACL adapter, cursors, cache, and authorization operations inside that worker."
        actions={<ThemeControl value={theme()} onChange={(value) => { setTheme(value); themeController?.setTheme(value); }} />}
      />
      <Show when={publication().phase === "loading"}>
        <PanelBoundary id="datascript-publication" title="Verifying DataScript deployment" busy>
          <LoadingState label="Checking the independently published profile and immutable worker identity." onCancel={() => publicationController?.abort()} />
        </PanelBoundary>
      </Show>
      <Show when={publication().phase === "error" ? publication() as Extract<PublicationState, { phase: "error" }> : null}>{(state) => {
        const failure = state();
        return <PanelBoundary id="datascript-publication-error" title="DataScript is unavailable"><ErrorState message={failure.message} code={failure.code} retryable onRetry={() => void loadPublication()} /></PanelBoundary>;
      }}</Show>
      <Show when={publication().phase === "ready" ? publication() as Extract<PublicationState, { phase: "ready" }> : null}>{(state) => {
        const ready = state();
        return <>
          <Show when={workerProgress()}>{(message) => <p class="registry-load-status" role="status" aria-live="polite" aria-atomic="true">{message()}</p>}</Show>
          <ServerExplorer profile={ready.profile} transportFactory={transportFactory} />
        </>;
      }}</Show>
    </main>
  );
}
