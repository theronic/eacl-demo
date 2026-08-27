import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import {
  PAGE_SIZE_OPTIONS,
  type PageSize,
  type SeedProgress,
} from "../types";
import { ButtonSpinner, ErrorBlock } from "./Common";

export function Header(): JSX.Element {
  const app = useAppState();
  const seedRequest = new LatestRequest();
  const [seedSize, setSeedSize] = createSignal("10000");
  const [seedError, setSeedError] = createSignal<unknown>();
  const bootstrap = () => app.bootstrapData();
  const ready = () => Boolean(bootstrap());
  const serverTotal = () => (ready() ? (bootstrap()?.data.totals.servers ?? 0) : 0);

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
      label: "Preparing Datahike transactions",
    });
    try {
      const result = await seedRequest.run<SeedProgress>("/api/seed", {
        method: "POST",
        body: JSON.stringify({ serverCount: value }),
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
    <header class="app-header">
      <div class="app-header__intro">
        <h1 class="app-title">🦅 EACL Explorer</h1>
        <p class="app-subtitle">
          Reactive authorization over explicit, inspectable HTTP queries.
        </p>
      </div>
      <div class="app-header__actions">
        <nav class="app-header__sources" aria-label="Source repositories">
          <a class="app-header__link" href="https://github.com/theronic/eacl">
            EACL Source
          </a>
          <a class="app-header__link" href="https://github.com/theronic/eacl-demo">
            Demo Source
          </a>
        </nav>
        <div class="app-header__controls">
          <div class="stat-pill" aria-live="polite">
            <span class="stat-pill__label">
              {app.bootstrap.loading
                ? "refreshing"
                : app.bootstrap.error
                  ? ready()
                    ? "stale"
                    : "unavailable"
                  : app.seeding()
                    ? "seeding"
                    : "ready"}
            </span>
            <strong>
              <Show
                when={app.seeding()}
                fallback={ready()
                  ? `${formatInteger(serverTotal())} servers`
                  : "Server total unavailable"}
              >
                {formatInteger(app.seedProgress()?.serversCompleted ?? 0)} /{" "}
                {formatInteger(app.seedProgress()?.serversTarget ?? 0)} servers
              </Show>
            </strong>
          </div>
          <label class="page-size-control">
            <span class="page-size-control__label">Page size</span>
            <select
              class="page-size-control__select"
              aria-label="Page size"
              disabled={!ready()}
              value={String(app.pageSize())}
              onChange={(event) =>
                app.setPageSize(Number(event.currentTarget.value) as PageSize)
              }
            >
              <For each={PAGE_SIZE_OPTIONS}>
                {(value) => <option value={value}>{formatInteger(value)}</option>}
              </For>
            </select>
          </label>
          <Show when={bootstrap()?.data.capabilities.seedWrite}>
            <form class="seed-controls" aria-busy={app.seeding()} onSubmit={seed}>
            <input
              class="seed-input"
              aria-label="Servers to seed"
              type="number"
              min="1"
              step="1"
              disabled={app.seeding() || !ready()}
              value={seedSize()}
              onInput={(event) => setSeedSize(event.currentTarget.value)}
            />
            <button
              class="seed-submit"
              type="submit"
              disabled={app.seeding() || !ready()}
              aria-busy={app.seeding()}
            >
              <Show when={app.seeding()}>
                <ButtonSpinner />
              </Show>
              {app.seeding() ? "Seeding…" : "Seed DB"}
            </button>
            </form>
          </Show>
          <button
            class="graph-toggle"
            type="button"
            onClick={() => app.setTheme(app.theme() === "dark" ? "light" : "dark")}
          >
            {app.theme() === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
        <Show when={seedError()}>{(error) => <ErrorBlock error={error()} />}</Show>
      </div>
    </header>
  );
}
