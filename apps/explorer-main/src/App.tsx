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
import {
  executionForPlatform,
  normalizePlatform,
  platformOptions,
  profileForPlatform,
} from "../../../packages/explorer-state/src/platforms.mjs";
import { selectBackend as transitionBackend } from "../../../packages/explorer-state/src/selection.mjs";
import { parseCanonicalUrl, serializeCanonicalUrl } from "../../../packages/explorer-state/src/url-state.mjs";
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
type StorageId = "s3" | "dynamodb" | "embedded" | "memory" | "browser-memory";
type PlatformId = "lambda-1769" | "lambda-4096" | "ec2" | "browser";
type ProfileState = "enabled" | "disabled" | "qualifying" | "unavailable";

interface Selection {
  backend: BackendId;
  storage: StorageId;
  platform: PlatformId;
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
      ? { backend: "datascript", storage: "browser-memory", platform: "browser" }
      : fromUrl,
  );
  const [registry, setRegistry] = createSignal(createFailClosedRegistry(availabilityData, profileData));
  const [registryLoaded, setRegistryLoaded] = createSignal(false);
  let shouldApplyRegistryDefault = !new URLSearchParams(window.location.search).has("storage");
  const publicationController = new AbortController();
  let urlController: any;

  onMount(() => {
    if (props.entry !== "datascript" && selection().backend === "datascript") {
      window.location.replace(`/datascript/${window.location.search}`);
      return;
    }
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
        platform: "browser" as const,
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
  const configuredProfile = createMemo(() => {
    const profile = selectedProfile();
    return profile ? profileForPlatform(profile, selection().platform) as ExplorerProfile : undefined;
  });
  const availablePlatforms = createMemo(() => platformOptions(selection()));
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
      const product = (transitionBackend as any)(catalog, selection(), backend, registryDefault(backend));
      const next = { ...product, platform: normalizePlatform(product, selection().platform) } as Selection;
      window.location.assign(`/${serializeCanonicalUrl(next, catalog)}`);
      return;
    }
    shouldApplyRegistryDefault = false;
    const product = (transitionBackend as any)(catalog, selection(), backend, registryDefault(backend));
    const next = { ...product, platform: normalizePlatform(product, selection().platform) } as Selection;
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
    const product = { ...selection(), storage: choice.storage };
    const next = { ...product, platform: normalizePlatform(product, product.platform) } as Selection;
    setSelection(next);
    urlController?.navigate({ ...parseCanonicalUrl(window.location.search, catalog).state, ...next });
  };

  const selectPlatform = (platform: PlatformId) => {
    const option = availablePlatforms().find((candidate) => candidate.id === platform);
    if (!option?.selectable) return;
    const next = { ...selection(), platform };
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
      platform={selection().platform}
      platforms={availablePlatforms()}
      onBackend={(backend) => selectBackend(backend as BackendId)}
      onStorage={(storage) => selectStorage(storage as StorageId)}
      onPlatform={(platform) => selectPlatform(platform as PlatformId)}
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
          const product = { ...selection(), storage: preferred };
          const next = { ...product, platform: normalizePlatform(product, product.platform) } as Selection;
          setSelection(next);
          urlController?.navigate(
            { ...parseCanonicalUrl(window.location.search, catalog).state, ...next },
            { replace: true },
          );
        }
      }
    } catch {
      return;
    } finally {
      if (!publicationController.signal.aborted) setRegistryLoaded(true);
    }
  };

  return (
    <Show
      keyed
      when={configuredProfile()?.state === "enabled" && configuredProfile()?.deployment
        ? selection().backend === "datascript" && !props.createDataScriptTransport
          ? { kind: "datascript-link" as const }
          : { kind: "explorer" as const, profile: configuredProfile() as ExplorerProfile }
        : null}
      fallback={
        <StandaloneExplorer
          backendLabel={selectedBackend().label}
          storageLabel={storageLabel()}
          selector={selector()}
          execution={executionForPlatform(selection().platform)}
          pending={!registryLoaded()}
        />
      }
    >
      {(entry) => entry.kind === "datascript-link" ? (
        <StandaloneExplorer
          backendLabel={selectedBackend().label}
          storageLabel={storageLabel()}
          selector={selector()}
          execution={executionForPlatform(selection().platform)}
          datascript
        />
      ) : (
        <ConfiguredExplorer
          profile={entry.profile}
          execution={executionForPlatform(selection().platform)}
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
  execution: "lambda" | "ec2" | "browser";
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
  execution: "lambda" | "ec2" | "browser";
  datascript?: boolean;
  pending?: boolean;
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
          <p class="app-subtitle">
            🦅 EACL: Enterprise Access ControL is a ReBAC Authorization library
            inspired by SpiceDB, built in Clojure and backed by Datomic Pro,
            Datahike or DataScript.
          </p>
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
          <Show when={props.pending} fallback={
            <Show
              when={props.datascript}
              fallback={<p class="empty-state">The selected demo is not available.</p>}
            >
              <a class="graph-toggle" href="/datascript/">
                Open DataScript explorer
              </a>
            </Show>
          }>
            <section class="startup-status" role="status" aria-live="polite">
              <span class="button-spinner" aria-hidden="true" />
              <div class="startup-status__copy">
                <strong>
                  {props.execution === "lambda"
                    ? `Waiting for ${props.backendLabel} Lambda to start... 0.0s`
                    : props.execution === "ec2"
                      ? `Connecting to ${props.backendLabel} EC2... 0.0s`
                      : `Loading ${props.backendLabel}... 0.0s`}
                </strong>
              </div>
            </section>
          </Show>
        </div>
      </main>
      <ExplorerFooter />
    </div>
  );
}
