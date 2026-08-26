import {
  createEffect,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { ApiError, LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import type {
  ApiSuccess,
  EaclObject,
  ObjectPage,
  PermissionDecision,
} from "../types";
import {
  EmptyState,
  ErrorBlock,
  InlineLoading,
  LoadingBlock,
  MetaTiming,
  Pagination,
  TypeBadge,
  identifierLabel,
} from "./Common";

function PermissionDecisionRow(props: {
  resource: EaclObject;
  permission: string;
}): JSX.Element {
  const app = useAppState();
  const request = new LatestRequest();
  const source = () =>
    ([
      app.subjectId(),
      props.resource.type,
      props.resource.id,
      props.permission,
      app.cacheEnabled(),
      app.mutationRevision(),
    ] as const);
  const [decision, { refetch }] = createResource(source, (input) =>
    request.run<PermissionDecision>("/api/eacl/check-permission", {
      method: "POST",
      body: JSON.stringify({
        subject: { type: "user", id: input[0] },
        resource: { type: input[1], id: input[2] },
        permission: input[3],
        cache: input[4],
      }),
    }),
  );
  const [displayedDecision, setDisplayedDecision] =
    createSignal<ApiSuccess<PermissionDecision>>();

  createEffect(() => {
    if (decision.loading || decision.error) return;
    const envelope = decision();
    if (envelope) setDisplayedDecision(envelope);
  });
  onCleanup(() => request.abort());

  return (
    <div
      class="permission-decision"
      aria-busy={decision.loading}
      data-permission={props.permission}
    >
      <div class="permission-decision__summary">
        <span class="permission-decision__permission">:{props.permission}</span>
        <Show when={displayedDecision()}>
          {(envelope) => (
            <strong
              class={`permission-decision__status permission-decision__status--${
                envelope().data.allowed ? "allowed" : "denied"
              }`}
              role="status"
              aria-live="polite"
            >
              {envelope().data.allowed ? "Allowed" : "Denied"}
            </strong>
          )}
        </Show>
      </div>
      <div class="permission-decision__meta">
        <MetaTiming meta={displayedDecision()?.meta} />
        <Show when={decision.loading}>
          <InlineLoading
            label={displayedDecision()
              ? `Refreshing ${props.permission} permission decision`
              : `Loading ${props.permission} permission decision`}
          />
        </Show>
      </div>
      <Show when={decision.error}>
        <ErrorBlock
          label={`:${props.permission} decision failed`}
          error={decision.error}
          retry={() => void refetch()}
        />
      </Show>
    </div>
  );
}

function PermissionDecisions(props: {
  resource: EaclObject;
  permissions: string[];
}): JSX.Element {
  const app = useAppState();
  return (
    <section
      class="panel-section permission-decisions"
      aria-labelledby="permission-decisions-title"
    >
      <div class="permission-decisions__heading">
        <div>
          <h3 id="permission-decisions-title">Can active subject?</h3>
          <p>{app.subjectId()}</p>
        </div>
      </div>
      <div class="permission-decisions__list">
        <For each={props.permissions}>
          {(permission) => (
            <PermissionDecisionRow
              resource={props.resource}
              permission={permission}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function PermissionSubjects(props: {
  resource: EaclObject;
  permission: string;
}): JSX.Element {
  const app = useAppState();
  const request = new LatestRequest();
  const [cursors, setCursors] = createSignal<string[]>([]);
  const cursor = () => cursors().at(-1);
  const source = () =>
    ([
          props.resource.type,
          props.resource.id,
          props.permission,
          app.pageSize(),
          cursor() ?? "",
          app.cacheEnabled(),
          app.mutationRevision(),
        ] as const);
  const [subjects, { refetch }] = createResource(source, (input) =>
    request.run<ObjectPage>("/api/eacl/lookup-subjects", {
      method: "POST",
      body: JSON.stringify({
        resource: { type: input[0], id: input[1] },
        permission: input[2],
        subjectType: "user",
        pageSize: input[3],
        after: input[4] || undefined,
        cache: input[5],
      }),
    }),
  );
  const [displayedSubjects, setDisplayedSubjects] =
    createSignal<ApiSuccess<ObjectPage>>();
  const [displayedCursors, setDisplayedCursors] = createSignal<string[]>([]);
  const [pendingAction, setPendingAction] =
    createSignal<"first" | "previous" | "next">();

  createEffect(() => {
    if (subjects.loading || subjects.error) return;
    const envelope = subjects();
    if (!envelope) return;
    setDisplayedSubjects(envelope);
    setDisplayedCursors([...cursors()]);
  });
  createEffect(() => {
    if (!subjects.loading) setPendingAction(undefined);
  });

  createEffect(
    on(
      () => [
        props.resource.type,
        props.resource.id,
        app.pageSize(),
        app.cacheEnabled(),
        app.queryGeneration(),
      ] as const,
      () => setCursors((current) => (current.length ? [] : current)),
      { defer: true },
    ),
  );
  onCleanup(() => request.abort());
  const settledSubjects = displayedSubjects;
  const navigationAction = () => {
    if (cursors().length > displayedCursors().length) return "next" as const;
    if (!cursors().length && displayedCursors().length) return "first" as const;
    if (cursors().length < displayedCursors().length) return "previous" as const;
    return undefined;
  };
  const navigate = (
    action: "first" | "previous" | "next",
    nextCursors: string[],
  ) => {
    if (subjects.loading) return;
    setPendingAction(action);
    setCursors(nextCursors);
  };
  const retrySubjects = () => {
    setPendingAction(navigationAction());
    void refetch();
  };
  const subjectRecovery = () => {
    if (!cursors().length) return undefined;
    return subjects.error instanceof ApiError && subjects.error.code === "invalid-cursor"
      ? { label: "First page", action: () => navigate("first", []) }
      : {
          label: "Previous page",
          action: () => navigate("previous", displayedCursors().slice(0, -1)),
        };
  };

  return (
    <section
      class="panel-section permission-subjects"
      data-permission={props.permission}
    >
      <div class="section-header">
        <p class="panel-label">:{props.permission}</p>
        <MetaTiming meta={settledSubjects()?.meta} />
      </div>
      <Show when={subjects.loading && !settledSubjects()}>
        <LoadingBlock
          label={`permission holders page ${formatInteger(cursors().length + 1)}`}
        />
      </Show>
      <Show when={subjects.error}>
        <ErrorBlock
          label={`Permission holders page ${formatInteger(cursors().length + 1)} failed`}
          error={subjects.error}
          retry={retrySubjects}
          secondary={subjectRecovery()}
        />
      </Show>
      <Show when={settledSubjects()}>
        {(envelope: () => ApiSuccess<ObjectPage>) => (
          <>
            <Pagination
              page={displayedCursors().length + 1}
              canPrevious={displayedCursors().length > 0}
              canNext={envelope().data.pageInfo.hasNextPage}
              busy={subjects.loading}
              busyAction={pendingAction()}
              first={() => navigate("first", [])}
              previous={() =>
                navigate("previous", displayedCursors().slice(0, -1))
              }
              next={() => {
                const next = envelope().data.pageInfo.endCursor;
                if (next) navigate("next", [...displayedCursors(), next]);
              }}
            />
            <div class="list-stack" aria-busy={subjects.loading}>
              <For
                each={envelope().data.items}
                fallback={<EmptyState>No subjects found.</EmptyState>}
              >
                {(subject) => (
                  <button
                    type="button"
                    class={`list-item ${app.subjectId() === subject.id ? "list-item--active" : ""}`}
                    onClick={() => app.setSubjectId(subject.id)}
                  >
                    <TypeBadge type={subject.type} />
                    <span class="resource-caption">
                      <span class="resource-caption__name">
                        {identifierLabel(subject.id)}
                      </span>
                      <span class="resource-caption__id">{subject.id}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}

export function DetailPanel(): JSX.Element {
  const app = useAppState();
  const permissions = () => {
    const selected = app.selectedResource();
    if (!selected) return [];
    return app.bootstrapData()?.data.schema.permissionsByType[selected.type] ?? [];
  };

  return (
    <div class="panel-card detail-panel">
      <h2 class="panel-kicker">Detail</h2>
      <Show
        when={app.selectedResource()}
        fallback={<EmptyState>Click a resource to inspect it.</EmptyState>}
      >
        {(selected) => (
          <>
            <div class="detail-header">
              <TypeBadge type={selected().type} />
              <div>
                <p class="detail-header__title">{identifierLabel(selected().type)}</p>
                <p class="detail-header__subtitle">
                  {identifierLabel(selected().id)}
                </p>
                <p class="detail-header__id">{selected().id}</p>
              </div>
            </div>
            <Show when={permissions().length > 0}>
              <PermissionDecisions
                resource={selected()}
                permissions={permissions()}
              />
            </Show>
            <For
              each={permissions()}
              fallback={<EmptyState>No permissions defined for this resource type.</EmptyState>}
            >
              {(permission) => (
                <PermissionSubjects resource={selected()} permission={permission} />
              )}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}
