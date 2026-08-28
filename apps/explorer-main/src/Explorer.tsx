import { onCleanup, Show, type JSX } from "solid-js";
import { CachePanel } from "./components/CachePanel";
import { CanPermissionFooter, type CanPermissionQuery } from "./components/CanPermissionFooter";
import { ConsistencyPanel } from "./components/ConsistencyPanel";
import { DetailPanel } from "./components/DetailPanel";
import { DeploymentWarning } from "./components/DeploymentWarning";
import { EmptyState, ErrorBlock, InlineLoading, LoadingBlock } from "./components/Common";
import { Header } from "./components/Header";
import { ResourceTreePanel } from "./components/ResourceTree";
import { SchemaPanel } from "./components/SchemaPanel";
import { SubjectsPanel } from "./components/SubjectsPanel";
import { formatInteger } from "./format";
import { useAppState } from "./state";
import { LatestRequest } from "./api";
import type { PermissionDecision } from "./types";

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
  execution: "lambda" | "ec2" | "browser";
}): JSX.Element {
  const app = useAppState();
  const hasBootstrap = () => Boolean(app.bootstrapData());
  const startupSeconds = () => (app.healthElapsedMs() / 1000).toFixed(1);
  const healthyEaclSha = () =>
    app.health.loading || app.health.error
      ? undefined
      : app.health()?.data.identity.eaclSha;
  const canRequest = new LatestRequest();
  const canDefaults = (): CanPermissionQuery => {
    const schema = app.bootstrapData()!.data.schema;
    const resourceType = schema.resourceTypes.includes("account")
      ? "account"
      : schema.resourceTypes.includes("server")
        ? "server"
        : schema.resourceTypes[0] ?? "";
    const permissions = schema.permissionsByType[resourceType] ?? [];
    return {
      subject: { type: "user", id: app.knownSubjects().find(({ id }) => id === "user-1")?.id ?? app.knownSubjects()[0]?.id ?? "user-1" },
      permission: permissions.includes("admin") ? "admin" : permissions[0] ?? "",
      resource: {
        type: resourceType,
        id: app.knownResources().find(({ type }) => type === resourceType)?.id
          ?? (resourceType === "account" ? "account-0" : resourceType === "server" ? "server-1" : ""),
      },
    };
  };
  onCleanup(() => canRequest.abort());
  return (
    <div class="app-shell" data-theme={app.theme()}>
      <Header />
      {props.profileSelector}
      <Show when={app.health()?.data.identityWarning}>
        {(warning) => (
          <DeploymentWarning backendLabel={props.backendLabel} warning={warning()} />
        )}
      </Show>
      <Show when={app.health.loading && !hasBootstrap()}>
        <main class="loading-grid">
          <section class="startup-status" role="status" aria-live="polite">
            <span class="button-spinner" aria-hidden="true" />
            <div class="startup-status__copy">
              <strong>
                {props.execution === "lambda"
                  ? `Waiting for ${props.backendLabel} Lambda to start... ${startupSeconds()}s`
                  : props.execution === "ec2"
                    ? `Connecting to ${props.backendLabel} EC2... ${startupSeconds()}s`
                  : `Loading ${props.backendLabel}... ${startupSeconds()}s`}
              </strong>
            </div>
          </section>
        </main>
      </Show>
      <Show when={app.health.error && !hasBootstrap()}>
        <main class="loading-grid">
          <ErrorBlock
            label={`${props.backendLabel} startup failed`}
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
      <Show when={!app.permission()}>
        <EmptyState>No permission is available in the active schema.</EmptyState>
      </Show>
      <Show when={app.bootstrapData()}>
        <CanPermissionFooter
          subjectTypes={[...new Set([
            ...app.bootstrapData()!.data.schema.nodes.map(({ id }) => id),
            ...Object.keys(app.bootstrapData()!.data.schema.childPaths),
          ])].sort()}
          subjects={app.knownSubjects}
          resourceTypes={app.bootstrapData()!.data.schema.resourceTypes}
          resources={app.knownResources}
          permissionsByType={app.bootstrapData()!.data.schema.permissionsByType}
          initial={canDefaults()}
          cache={app.cacheEnabled}
          populateCache={app.populateCache}
          consistency={app.consistency}
          query={(input, options) => app.runQuery<PermissionDecision>(canRequest, "/check-permission", {
            method: "POST",
            body: JSON.stringify({ ...input, ...options }),
          })}
        />
      </Show>
      <ExplorerFooter eaclSha={healthyEaclSha()} />
    </div>
  );
}

export function ExplorerFooter(props: { eaclSha?: string }): JSX.Element {
  return (
    <footer class="app-footer">
      <p class="app-footer__copy">
        EACL is <a href="https://github.com/theronic/eacl">open source</a> under EPL 2.0. EACL Explorer ©️ 2026 <a href="https://petrustheron.com/">Petrus Theron</a>.
      </p>
      <Show when={props.eaclSha}>
        {(sha) => (
          <p class="app-footer__copy app-footer__version">
            EACL library Git SHA: <a href={`https://github.com/theronic/eacl/commit/${sha()}`}><code>{sha()}</code></a>
          </p>
        )}
      </Show>
    </footer>
  );
}
