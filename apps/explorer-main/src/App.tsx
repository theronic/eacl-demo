import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import catalogData from "../../../packages/contracts/backend-storage.v1.json";
import availabilityData from "../../../registry/profile-registry.v1.json";
import profileData from "../../../packages/contracts/profiles.v1.json";
import { choicesForBackend } from "../../../packages/explorer-state/src/availability.mjs";
import { loadBenchmarkEvidence } from "../../../packages/explorer-state/src/benchmark-publication.mjs";
import { composeProfileRegistry, createFailClosedRegistry, loadProfilePublications } from "../../../packages/explorer-state/src/profile-publication.mjs";
import { selectBackend as transitionBackend } from "../../../packages/explorer-state/src/selection.mjs";
import { parseCanonicalUrl } from "../../../packages/explorer-state/src/url-state.mjs";
import { createUrlStateController } from "../../../packages/explorer-state/src/url-controller.mjs";
import { ExplorerHeader, ProfileSelector, ThemeControl } from "../../../packages/ui/src/components";
import { createThemeController, readUiPreferences } from "../../../packages/explorer-state/src/ui-preferences.mjs";
import ServerExplorer from "./ServerExplorer";

type BackendId = "datahike" | "datomic" | "datalevin" | "jank" | "datascript";
type StorageId = "s3" | "dynamodb" | "memory" | "browser-memory";
type ProfileState = "enabled" | "disabled" | "qualifying" | "unavailable";

interface Selection {
  backend: BackendId;
  storage: StorageId;
}

interface DeploymentIdentity {
  demoSha: string;
  eaclSha: string;
  artifact: { kind: "static" | "lambda-version" | "browser-worker"; sha256: string; version: string };
  deploymentId: string;
  dataManifestSha256: string;
  deployedAt: string;
}

interface DeploymentOutcome {
  outcome: "never-deployed" | "succeeded" | "failed" | "rolled-back";
  attemptedDemoSha: string | null;
  attemptedEaclSha: string | null;
  artifactSha256: string | null;
  at: string | null;
  message: string;
}

const catalog = catalogData as {
  defaultBackend: BackendId;
  backends: Array<{ id: BackendId; label: string; storages: StorageId[] }>;
  storages: Array<{ id: StorageId; label: string }>;
};

export default function App() {
  const initialPreferences = readUiPreferences();
  const [theme, setTheme] = createSignal<"system" | "light" | "dark">(initialPreferences.theme as "system" | "light" | "dark");
  const initialBackend = catalog.backends.find(({ id }) => id === catalog.defaultBackend) ?? catalog.backends[0];
  const fromUrl = parseCanonicalUrl(window.location.search, catalog).state as Selection;
  const [selection, setSelection] = createSignal<Selection>(fromUrl);
  const [registry, setRegistry] = createSignal(createFailClosedRegistry(availabilityData, profileData));
  let shouldApplyRegistryDefault = !new URLSearchParams(window.location.search).has("storage");
  const publicationController = new AbortController();
  let urlController: any;
  let themeController: any;
  onMount(() => {
    urlController = (createUrlStateController as any)({ catalog, history: window.history, location: window.location, eventTarget: window, onState: (state: unknown) => setSelection(state as Selection) });
    themeController = (createThemeController as any)({ onChange: ({ preference }: { preference: string }) => setTheme(preference as "system" | "light" | "dark") });
    void refreshProfilePublications();
  });
  onCleanup(() => { publicationController.abort(); urlController?.close(); themeController?.close(); });
  const selectedBackend = createMemo(() => catalog.backends.find(({ id }) => id === selection().backend) ?? initialBackend);
  const storageOptions = createMemo(() => selectedBackend().storages.map((id) => catalog.storages.find((storage) => storage.id === id)!));
  const profileChoices = createMemo(() => choicesForBackend(catalog, profileData, registry(), selection().backend) as Array<{ id: string; storage: StorageId; label: string; state: ProfileState; reason: string | null; selectable: boolean; deployment?: DeploymentIdentity | null; lastOutcome?: DeploymentOutcome }>);
  const selectedProfile = createMemo(() => registry().profiles.find((candidate: { backend: string; storage: string }) => candidate.backend === selection().backend && candidate.storage === selection().storage));
  const registryDefault = (backend: BackendId) => registry().storageDefaults.find((candidate: { backend: string }) => candidate.backend === backend)?.storage as StorageId | null;

  const selectBackend = (backend: BackendId) => {
    shouldApplyRegistryDefault = false;
    const next = (transitionBackend as any)(catalog, selection(), backend, registryDefault(backend)) as Selection;
    setSelection(next);
    urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next });
  };

  const refreshProfilePublications = async () => {
    try {
      const [loaded, benchmarks] = await Promise.all([
        loadProfilePublications({ baseUrl: window.location.href, profileDefinitions: profileData, baseRegistry: availabilityData, signal: publicationController.signal }),
        loadBenchmarkEvidence({ baseUrl: window.location.href, signal: publicationController.signal })
      ]);
      const composed = await (composeProfileRegistry as any)({ baseRegistry: availabilityData, profileDefinitions: profileData, publications: loaded.publications, evidenceRecords: benchmarks.evidenceRecords });
      if (publicationController.signal.aborted) return;
      setRegistry(composed.registry);
      if (shouldApplyRegistryDefault) {
        shouldApplyRegistryDefault = false;
        const preferred = registryDefault(selection().backend);
        if (preferred && preferred !== selection().storage) {
          const next = { ...selection(), storage: preferred };
          setSelection(next);
          urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next }, { replace: true });
        }
      }
    } catch { return; }
  };

  return (
    <main class="app-shell">
      <ExplorerHeader
        eyebrow={`EACL v8 + ${selectedBackend().label} + ${storageOptions().find(({ id }) => id === selection().storage)?.label ?? selection().storage} + SolidJS`}
        title="🦅 EACL Explorer"
        description="Reactive authorization over explicit, inspectable HTTP queries."
        actions={<>
          <nav class="explorer-header__sources" aria-label="Source repositories">
            <a class="explorer-header__link" href="https://github.com/theronic/eacl">EACL Source</a>
            <a class="explorer-header__link" href="https://github.com/theronic/eacl-demo">Demo Source</a>
          </nav>
          <ThemeControl value={theme()} onChange={(value) => { setTheme(value); themeController?.setTheme(value); }} />
        </>}
      />
      <ProfileSelector
        backends={catalog.backends}
        backend={selection().backend}
        storage={selection().storage}
        storageChoices={profileChoices()}
        onBackend={(backend) => selectBackend(backend as BackendId)}
        onStorage={(storage) => {
          shouldApplyRegistryDefault = false;
          const choice = profileChoices().find((candidate) => candidate.storage === storage);
          if (!choice?.selectable) return;
          const next = { ...selection(), storage: choice.storage };
          setSelection(next);
          urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next });
        }}
      />
      <Show
        when={selection().backend === "datascript"}
        fallback={<Show when={selectedProfile()?.state === "enabled" && selectedProfile()?.deployment ? selectedProfile() : null}>{(profile) => <ServerExplorer profile={profile() as any} />}</Show>}
      >
        <section class="datascript-entry-callout" aria-label="DataScript explorer"><a class="button" href="/datascript/" target="_blank" rel="noopener noreferrer">Open DataScript explorer in a new tab</a></section>
      </Show>
    </main>
  );
}
