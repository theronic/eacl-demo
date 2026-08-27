import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import catalogData from "../../../packages/contracts/backend-storage.v1.json";
import availabilityData from "../../../registry/profile-registry.v1.json";
import profileData from "../../../packages/contracts/profiles.v1.json";
import { choicesForBackend } from "../../../packages/explorer-state/src/availability.mjs";
import {
  composeProfileRegistry,
  createFailClosedRegistry,
  loadProfilePublications,
} from "../../../packages/explorer-state/src/profile-publication.mjs";
import { selectBackend as transitionBackend } from "../../../packages/explorer-state/src/selection.mjs";
import { parseCanonicalUrl } from "../../../packages/explorer-state/src/url-state.mjs";
import { createUrlStateController } from "../../../packages/explorer-state/src/url-controller.mjs";
import { ApiProvider } from "./api";
import { ProfileSelector } from "./components/ProfileSelector";
import { Explorer, ExplorerFooter } from "./Explorer";
import {
  createProfileApi,
  type ExplorerProfile,
  type ExplorerTransport,
} from "./profile-api";
import { readPreferences, writePreferences } from "./preferences";
import { AppStateProvider } from "./state";

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
  artifact: {
    kind: "static" | "lambda-version";
    sha256: string;
    version: string;
  };
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

interface ProfileChoice {
  id: string;
  storage: StorageId;
  apiOrigin: string | null;
  label: string;
  state: ProfileState;
  reason: string | null;
  selectable: boolean;
  deployment?: DeploymentIdentity | null;
  lastOutcome?: DeploymentOutcome;
}

const catalog = catalogData as {
  defaultBackend: BackendId;
  backends: Array<{ id: BackendId; label: string; storages: StorageId[] }>;
  storages: Array<{ id: StorageId; label: string }>;
};

export interface ExplorerAppProps {
  entry?: "server" | "datascript";
  createDataScriptTransport?: (profile: ExplorerProfile) => ExplorerTransport;
}

export default function App(props: ExplorerAppProps): JSX.Element {
  const initialBackend = catalog.backends.find(({ id }) => id === catalog.defaultBackend) ?? catalog.backends[0];
  const fromUrl = parseCanonicalUrl(window.location.search, catalog).state as Selection;
  const [selection, setSelection] = createSignal<Selection>(
    props.entry === "datascript"
      ? { backend: "datascript", storage: "browser-memory" }
      : fromUrl,
  );
  const [registry, setRegistry] = createSignal(createFailClosedRegistry(availabilityData, profileData));
  let shouldApplyRegistryDefault = !new URLSearchParams(window.location.search).has("storage");
  const publicationController = new AbortController();
  let urlController: any;

  onMount(() => {
    urlController = (createUrlStateController as any)({
      catalog,
      history: window.history,
      location: window.location,
      eventTarget: window,
      onState: (state: unknown) => setSelection(state as Selection),
    });
    if (props.entry === "datascript") {
      const next = {
        ...(parseCanonicalUrl(window.location.search, catalog).state as Selection),
        backend: "datascript" as const,
        storage: "browser-memory" as const,
      };
      setSelection(next);
      urlController.navigate(next, { replace: true });
    }
    void refreshProfilePublications();
  });
  onCleanup(() => {
    publicationController.abort();
    urlController?.close();
  });

  const visibleBackends = createMemo(() => catalog.backends.filter(({ id }) => id !== "jank"));
  const selectedBackend = createMemo(() =>
    catalog.backends.find(({ id }) => id === selection().backend) ?? initialBackend,
  );
  const profileChoices = createMemo(() =>
    choicesForBackend(catalog, profileData, registry(), selection().backend) as ProfileChoice[],
  );
  const selectedProfile = createMemo(() =>
    profileChoices().find((candidate) => candidate.storage === selection().storage),
  );
  const storageLabel = createMemo(() =>
    catalog.storages.find(({ id }) => id === selection().storage)?.label ?? selection().storage,
  );
  const registryDefault = (backend: BackendId) =>
    registry().storageDefaults.find((candidate: { backend: string }) => candidate.backend === backend)?.storage as StorageId | null;

  const selectBackend = (backend: BackendId) => {
    if (backend === "datascript" && props.entry !== "datascript") {
      window.location.assign("/datascript/");
      return;
    }
    if (backend !== "datascript" && props.entry === "datascript") {
      const next = (transitionBackend as any)(catalog, selection(), backend, registryDefault(backend)) as Selection;
      window.location.assign(`/?backend=${encodeURIComponent(next.backend)}&storage=${encodeURIComponent(next.storage)}`);
      return;
    }
    shouldApplyRegistryDefault = false;
    const next = (transitionBackend as any)(catalog, selection(), backend, registryDefault(backend)) as Selection;
    setSelection(next);
    urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next });
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>(
        `input[name="explorer-backend"][value="${backend}"]`,
      )?.focus();
    });
  };

  const selectStorage = (storage: StorageId) => {
    shouldApplyRegistryDefault = false;
    const choice = profileChoices().find((candidate) => candidate.storage === storage);
    if (!choice?.selectable) return;
    const next = { ...selection(), storage: choice.storage };
    setSelection(next);
    urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next });
  };

  const selector = () => (
    <ProfileSelector
      backends={visibleBackends()}
      backend={selection().backend}
      storage={selection().storage}
      storages={profileChoices().map((choice) => ({
        id: choice.storage,
        label: choice.label,
        selectable: choice.selectable,
        reason: choice.reason,
      }))}
      onBackend={(backend) => selectBackend(backend as BackendId)}
      onStorage={(storage) => selectStorage(storage as StorageId)}
    />
  );

  const refreshProfilePublications = async () => {
    try {
      const loaded = await loadProfilePublications({
        baseUrl: window.location.href,
        profileDefinitions: profileData,
        baseRegistry: availabilityData,
        signal: publicationController.signal,
      });
      const composed = await (composeProfileRegistry as any)({
        baseRegistry: availabilityData,
        profileDefinitions: profileData,
        publications: loaded.publications,
      });
      if (publicationController.signal.aborted) return;
      setRegistry(composed.registry);
      if (shouldApplyRegistryDefault) {
        shouldApplyRegistryDefault = false;
        const preferred = registryDefault(selection().backend);
        if (preferred && preferred !== selection().storage) {
          const next = { ...selection(), storage: preferred };
          setSelection(next);
          urlController?.navigate(
            { ...parseCanonicalUrl(window.location.search, catalog).state, ...next },
            { replace: true },
          );
        }
      }
    } catch {
      return;
    }
  };

  return (
    <Show
      keyed
      when={selectedProfile()?.state === "enabled" && selectedProfile()?.deployment
        ? selection().backend === "datascript" && !props.createDataScriptTransport
          ? { kind: "datascript-link" as const }
          : { kind: "explorer" as const, profile: selectedProfile() as ExplorerProfile }
        : null}
      fallback={
        <StandaloneExplorer
          backendLabel={selectedBackend().label}
          storageLabel={storageLabel()}
          selector={selector()}
        />
      }
    >
      {(entry) => entry.kind === "datascript-link" ? (
        <StandaloneExplorer
          backendLabel={selectedBackend().label}
          storageLabel={storageLabel()}
          selector={selector()}
          datascript
        />
      ) : (
        <ConfiguredExplorer
          profile={entry.profile}
          execution={entry.profile.backend === "datascript" ? "browser" : "lambda"}
          backendLabel={selectedBackend().label}
          storageLabel={storageLabel()}
          selector={selector()}
          transport={entry.profile.backend === "datascript"
            ? props.createDataScriptTransport?.(entry.profile)
            : undefined}
        />
      )}
    </Show>
  );
}

function ConfiguredExplorer(props: {
  profile: ExplorerProfile;
  execution: "lambda" | "browser";
  backendLabel: string;
  storageLabel: string;
  selector: JSX.Element;
  transport?: ExplorerTransport;
}): JSX.Element {
  const api = createProfileApi(props.profile, { transport: props.transport });
  onCleanup(() => void api.release());
  return (
    <ApiProvider dispatcher={api.dispatcher}>
      <AppStateProvider>
        <Explorer
          backendLabel={props.backendLabel}
          storageLabel={props.storageLabel}
          profileSelector={props.selector}
          execution={props.execution}
        />
      </AppStateProvider>
    </ApiProvider>
  );
}

function StandaloneExplorer(props: {
  backendLabel: string;
  storageLabel: string;
  selector: JSX.Element;
  datascript?: boolean;
}): JSX.Element {
  const [theme, setTheme] = createSignal(readPreferences().theme);
  const toggleTheme = () => {
    const next = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    writePreferences({ ...readPreferences(), theme: next });
  };
  document.documentElement.dataset.theme = theme();
  return (
    <div class="app-shell" data-theme={theme()}>
      <header class="app-header">
        <div class="app-header__intro">
          <h1 class="app-title">🦅 EACL Explorer</h1>
          <p class="app-subtitle">Reactive authorization over explicit, inspectable HTTP queries.</p>
        </div>
        <div class="app-header__actions">
          <nav class="app-header__sources" aria-label="Source repositories">
            <a class="app-header__link" href="https://github.com/theronic/eacl">EACL Source</a>
            <a class="app-header__link" href="https://github.com/theronic/eacl-demo">Demo Source</a>
          </nav>
          <div class="app-header__controls">
            <button class="graph-toggle" type="button" onClick={toggleTheme}>
              {theme() === "dark" ? "Light theme" : "Dark theme"}
            </button>
          </div>
        </div>
      </header>
      {props.selector}
      <main class="loading-grid">
        <div class="panel-card">
          <Show
            when={props.datascript}
            fallback={<p class="empty-state">The selected demo is not available.</p>}
          >
            <a class="graph-toggle" href="/datascript/">
              Open DataScript explorer
            </a>
          </Show>
        </div>
      </main>
      <ExplorerFooter />
    </div>
  );
}
