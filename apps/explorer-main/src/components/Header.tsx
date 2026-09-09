import { DesignIcon } from "./DesignIcon";
import {
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import { PAGE_SIZE_OPTIONS, type PageSize, type SeedProgress } from "../types";
import { SubjectsPanel } from "./SubjectsPanel";
import { ButtonSpinner, ErrorBlock } from "./Common";

export function Header(): JSX.Element {
  let picker!: HTMLDialogElement;
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const app = useAppState();
  const seedRequest = new LatestRequest();
  const countRequest = new LatestRequest();
  const [relationshipCount] = createResource(
    () => app.bootstrapData()?.meta.revision,
    () =>
      app.runQuery<{ value: number; exact: boolean; estimatedTotal?: number }>(
        countRequest,
        "/count-objects",
      ),
  );
  onCleanup(() => countRequest.abort());
  const [seedSize, setSeedSize] = createSignal("10000");
  const [seedError, setSeedError] = createSignal<unknown>();
  const bootstrap = () => app.bootstrapData();
  const ready = () => Boolean(bootstrap());
  const localSeed = () => bootstrap()?.data.localSeed;
  const unit = () => (localSeed() ? "resources" : "servers");
  const resourceTotal = () =>
    app.seedProgress()?.totalResources ??
    bootstrap()?.data.totals.resources ??
    0;
  const serverTotal = () =>
    ready() ? (bootstrap()?.data.totals.servers ?? 0) : 0;

  const seed = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = Number(seedSize());
    if (!Number.isSafeInteger(value) || value <= 0) {
      setSeedError(new Error("Seed size must be a positive whole number."));
      return;
    }
    setSeedError(undefined);
    app.setSeedProgress({
      status: "seeding",
      serversAdded: 0,
      serversCompleted: 0,
      serversTarget: value,
      totalServers: serverTotal(),
      totalResources: resourceTotal(),
      unit: localSeed() ? "resources" : undefined,
      label: "Preparing local resources",
    });
    try {
      const result = await seedRequest.run<SeedProgress>("/seed", {
        method: "POST",
        body: JSON.stringify({ resourceCount: value }),
      });
      app.setSeedProgress(result.data);
    } catch (error) {
      app.setSeedProgress({
        status: "error",
        serversAdded: 0,
        serversCompleted: 0,
        serversTarget: value,
        totalServers: serverTotal(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  onCleanup(() => seedRequest.abort());

  return (
    <>
      <ExplorerHeading>
        <div class="app-header__controls">
          <div class="navbar-count">
            <strong>{ready() ? formatInteger(resourceTotal()) : "—"}</strong>
            <span>objects</span>
          </div>
          <div class="navbar-count">
            <strong>
              {relationshipCount.error
                ? "—"
                : relationshipCount()
                  ? relationshipCount()!.data.estimatedTotal !== undefined
                    ? `≈${formatInteger(relationshipCount()!.data.estimatedTotal!)}`
                    : `${formatInteger(relationshipCount()!.data.value)}${relationshipCount()!.data.exact ? "" : "+"}`
                  : "…"}
            </strong>
            <span>relationships</span>
          </div>
          <Show when={bootstrap()?.data.capabilities.seedWrite}>
            <form class="seed-controls" onSubmit={seed}>
              <input
                class="seed-input"
                aria-label="Additional resources"
                type="number"
                min="1"
                step="1"
                disabled={app.seeding() || !ready()}
                value={seedSize()}
                onInput={(e) => setSeedSize(e.currentTarget.value)}
              />
              <button
                class="seed-submit"
                type="submit"
                disabled={app.seeding() || !ready()}
              >
                {app.seeding() ? "Seeding…" : "Seed Data"}
              </button>
            </form>
          </Show>
          <button
            class="theme-button"
            aria-label={
              app.theme() === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            onClick={() =>
              app.setTheme(app.theme() === "dark" ? "light" : "dark")
            }
          >
            <DesignIcon name={app.theme() === "dark" ? "sun" : "moon"} />
          </button>
          <button
            class="view-as-button"
            disabled={!ready()}
            onClick={() => {
              setPickerOpen(true);
              picker.showModal();
            }}
            aria-haspopup="dialog"
          >
            <ViewAsLabel
              subjectId={app.subjectId()}
              subjectType={app.subjectType()}
            />
          </button>
        </div>
        <Show when={seedError()}>
          {(error) => <ErrorBlock error={error()} />}
        </Show>
      </ExplorerHeading>
      <dialog
        class="view-as-dialog"
        ref={picker}
        onClose={() => setPickerOpen(false)}
        aria-labelledby="view-as-title"
      >
        <header>
          <h2 id="view-as-title">View As</h2>
          <button aria-label="Close View As" onClick={() => picker.close()}>
            ×
          </button>
        </header>
        <Show when={ready() && pickerOpen()}>
          <SubjectsPanel onSelect={() => picker.close()} />
        </Show>
      </dialog>
    </>
  );
}

export function ExplorerHeading(props: { children: JSX.Element }): JSX.Element {
  return (
    <>
      <header class="app-header">
        <h1 class="app-title">
          <span class="brand-eagle" aria-hidden="true">
            🦅
          </span>{" "}
          <strong>EACL</strong> <span class="brand-product">Explorer</span>
        </h1>
        <nav class="app-header__sources" aria-label="Source repositories">
          <a href="https://github.com/theronic/eacl">EACL Source ↗</a>
          <a href="https://github.com/theronic/eacl-demo">Demo Source ↗</a>
        </nav>
        {props.children}
      </header>
      <p class="app-subtitle">
        <a href="https://github.com/theronic/eacl">EACL</a> is a situated{" "}
        <a href="https://en.wikipedia.org/wiki/Relationship-based_access_control">
          ReBAC
        </a>{" "}
        authorization library inspired by{" "}
        <a href="https://authzed.com/spicedb">SpiceDB</a>, built in{" "}
        <a href="https://clojure.org/">Clojure</a> and backed by{" "}
        <a href="https://datomic.com/">Datomic Pro</a>,{" "}
        <a href="https://datahike.io/">Datahike</a>,{" "}
        <a href="https://datalevin.org/">Datalevin</a> or{" "}
        <a href="https://github.com/tonsky/datascript">DataScript</a>.
      </p>
    </>
  );
}

export function ViewAsLabel(props: {
  subjectId: string;
  subjectType?: string;
}): JSX.Element {
  return (
    <>
      <span class="principal-avatar" aria-hidden="true">
        {props.subjectType && props.subjectType !== "user"
          ? props.subjectType[0].toUpperCase()
          : props.subjectId === "super-user"
            ? "SU"
            : `U${props.subjectId.match(/^user-(\d+)$/)?.[1] ?? ""}`}
      </span>
      <span class="principal-label">
        <small>View As</small>
        <strong>{props.subjectId}</strong>
      </span>
      <span aria-hidden="true">⌄</span>
    </>
  );
}
