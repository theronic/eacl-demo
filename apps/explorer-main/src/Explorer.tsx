import { Show, type Accessor, type JSX } from "solid-js";
import { CachePanel } from "./components/CachePanel";
import { ConsistencyPanel } from "./components/ConsistencyPanel";
import { DetailPanel } from "./components/DetailPanel";
import { EmptyState, ErrorBlock, InlineLoading, LoadingBlock } from "./components/Common";
import { Header } from "./components/Header";
import { ResourceTreePanel } from "./components/ResourceTree";
import { SchemaPanel } from "./components/SchemaPanel";
import { SubjectsPanel } from "./components/SubjectsPanel";
import { formatInteger } from "./format";
import { useAppState } from "./state";

function SeedProgress(): JSX.Element {
  const app = useAppState();
  const progress = () => app.seedProgress();
  const percent = () => {
    const target = Math.max(1, progress()?.serversTarget ?? 1);
    return Math.min(100, ((progress()?.serversCompleted ?? 0) / target) * 100);
  };
  return (
    <section class="seed-progress-banner" aria-live="polite">
      <div class="seed-progress-banner__copy">
        <strong>Seeding Datahike</strong>
        <span>
          {formatInteger(progress()?.serversCompleted ?? 0)} / {" "}
          {formatInteger(progress()?.serversTarget ?? 0)} servers
        </span>
        <span class="seed-progress-card__label">
          {progress()?.label ?? "Applying managed EACL relationships"}
        </span>
      </div>
      <div
        class="seed-progress-card__track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(percent())}
      >
        <div class="seed-progress-card__fill" style={{ width: `${percent()}%` }} />
      </div>
    </section>
  );
}

export function Explorer(props: {
  backendLabel: string;
  storageLabel: string;
  profileSelector: JSX.Element;
  startupMessage?: Accessor<string | null>;
}): JSX.Element {
  const app = useAppState();
  const hasBootstrap = () => Boolean(app.bootstrapData());
  const startupSeconds = () => (app.healthElapsedMs() / 1000).toFixed(1);
  return (
    <div class="app-shell" data-theme={app.theme()}>
      <Header backendLabel={props.backendLabel} storageLabel={props.storageLabel} />
      {props.profileSelector}
      <Show when={app.health.loading && !hasBootstrap()}>
        <main class="loading-grid">
          <section class="startup-status" role="status" aria-live="polite">
            <span class="button-spinner" aria-hidden="true" />
            <div class="startup-status__copy">
              <strong>Starting {props.startupMessage ? "DataScript" : props.backendLabel}</strong>
              <span>{props.startupMessage?.() ?? "Waiting for a direct health check"} · {startupSeconds()}s</span>
            </div>
          </section>
        </main>
      </Show>
      <Show when={app.health.error && !hasBootstrap()}>
        <main class="loading-grid">
          <ErrorBlock
            label="Lambda reader health check failed"
            error={app.health.error}
            retry={app.refetchHealth}
          />
        </main>
      </Show>
      <Show when={app.bootstrap.loading && !hasBootstrap()}>
        <main class="loading-grid">
          <LoadingBlock label="explorer" />
        </main>
      </Show>
      <Show when={app.bootstrap.error && !hasBootstrap()}>
        <main class="loading-grid">
          <ErrorBlock
            label="Explorer bootstrap failed"
            error={app.bootstrap.error}
            retry={app.refetchBootstrap}
          />
        </main>
      </Show>
      <Show when={hasBootstrap()}>
        <Show when={app.bootstrap.loading}>
          <section class="request-status-banner">
            <InlineLoading label="Refreshing explorer data" />
          </section>
        </Show>
        <Show when={app.bootstrap.error}>
          <section class="request-error-banner">
            <ErrorBlock
              label="Explorer refresh failed"
              error={app.bootstrap.error}
              retry={app.refetchBootstrap}
            />
          </section>
        </Show>
        <Show when={app.seeding()}>
          <SeedProgress />
        </Show>
        <Show when={app.seedProgress()?.status === "error"}>
          <section class="request-error-banner">
            <ErrorBlock
              label="Seed status request failed"
              error={app.seedProgress()?.error ?? "Seed status is unavailable."}
              retry={app.retrySeedPoll}
            />
          </section>
        </Show>
        <SchemaPanel />
        <CachePanel />
        <ConsistencyPanel />
        <main class="panel-grid">
          <section class="panel-host">
            <SubjectsPanel />
          </section>
          <section class="panel-host">
            <ResourceTreePanel />
          </section>
          <section class="panel-host">
            <DetailPanel />
          </section>
        </main>
      </Show>
      <footer class="app-footer">
        <p class="app-footer__copy">
          EACL authorization runs on {props.backendLabel}; the explorer receives
          only bounded results.
        </p>
        <Show when={!app.permission()}>
          <EmptyState>No permission is available in the active schema.</EmptyState>
        </Show>
      </footer>
    </div>
  );
}
