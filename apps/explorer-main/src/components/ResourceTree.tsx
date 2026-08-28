import {
  createEffect,
  createMemo,
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
  ChildPath,
  EaclObject,
  ObjectPage,
  RelationshipPage,
  ResourceCount,
} from "../types";
import {
  DisclosureButton,
  EmptyState,
  ErrorBlock,
  InlineError,
  InlineLoading,
  LoadingBlock,
  MetaTiming,
  Pagination,
  TypeBadge,
  identifierLabel,
} from "./Common";

const resourceKey = (resource: EaclObject) => `${resource.type}:${resource.id}`;
type ScopedSuccess<T> = {
  scope: string;
  envelope: ApiSuccess<T>;
};

const scopeKey = (...parts: unknown[]) => JSON.stringify(parts);

const initialCountLimit = 1_000;
const maximumCountLimit = 30_000;

const nextCountLimit = (current: number) =>
  Math.min(maximumCountLimit, current * 2);

export function resourceCountPresentation(
  count: ResourceCount | undefined,
  observedRangeEnd: number,
  pageHasNext: boolean,
): { value: number; truncated: boolean } {
  const counted = count?.count ?? 0;
  const value = Math.max(counted, observedRangeEnd);
  return {
    value,
    truncated:
      Boolean(count?.truncated) || value > counted || (!count && pageHasNext),
  };
}

function RelationshipGroup(props: {
  parent: EaclObject;
  path: ChildPath;
  ancestry: ReadonlySet<string>;
}): JSX.Element {
  const app = useAppState();
  const key = () =>
    `relationship:${resourceKey(props.parent)}:${props.path.resourceType}:${props.path.relation}`;
  const expanded = () => app.isExpanded(key());
  const request = new LatestRequest();
  const [cursors, setCursors] = createSignal<string[]>([]);
  const cursor = () => cursors().at(-1);
  const relationshipScope = () =>
    scopeKey(
      props.parent.type,
      props.parent.id,
      props.path.resourceType,
      props.path.relation,
      app.subjectId(),
      app.permission(),
      app.activeQueryBasis(),
      JSON.stringify(app.consistency()),
    );
  const relationshipScopeFromInput = (input: readonly unknown[]) =>
    scopeKey(
      input[0],
      input[1],
      input[2],
      input[3],
      input[4],
      input[5],
      input[10],
      input[13],
    );
  const source = () =>
    expanded() && app.permission()
      ? ([
          props.parent.type,
          props.parent.id,
          props.path.resourceType,
          props.path.relation,
          app.subjectId(),
          app.permission(),
          app.pageSize(),
          cursor() ?? "",
          app.cacheEnabled(),
          app.populateCache(),
          app.activeQueryBasis(),
          app.basisGeneration(),
          app.queryGeneration(),
          JSON.stringify(app.consistency()),
        ] as const)
      : false;
  const [relationships, { refetch }] = createResource(source, async (input) => ({
    scope: relationshipScopeFromInput(input),
    envelope: await app.runQuery<RelationshipPage>(request, "/list-relationships", {
      method: "POST",
      body: JSON.stringify({
        subject: { type: input[0], id: input[1] },
        resourceType: input[2],
        relation: input[3],
        authorizationSubject: { type: "user", id: input[4] },
        permission: input[5],
        pageSize: input[6],
        after: input[7] || undefined,
        cache: input[8],
        populateCache: input[9],
        consistency: app.consistency(),
      }),
    }),
  } satisfies ScopedSuccess<RelationshipPage>));
  const [displayedRelationships, setDisplayedRelationships] =
    createSignal<ApiSuccess<RelationshipPage>>();
  const [displayedRelationshipScope, setDisplayedRelationshipScope] =
    createSignal("");
  const [displayedCursors, setDisplayedCursors] = createSignal<string[]>([]);
  const [pendingAction, setPendingAction] =
    createSignal<"first" | "previous" | "next">();

  createEffect(() => {
    if (relationships.loading || relationships.error) return;
    const result = relationships();
    if (!result) return;
    setDisplayedRelationships(result.envelope);
    setDisplayedRelationshipScope(result.scope);
    setDisplayedCursors([...cursors()]);
  });
  createEffect(() => {
    if (!relationships.loading) setPendingAction(undefined);
  });

  createEffect(
    on(
      () => [
        app.subjectId(),
        app.permission(),
        app.pageSize(),
        app.queryGeneration(),
        app.basisGeneration(),
        JSON.stringify(app.consistency()),
      ] as const,
      () => setCursors((current) => (current.length ? [] : current)),
      { defer: true },
    ),
  );
  onCleanup(() => request.abort());
  const settledRelationships = () =>
    displayedRelationshipScope() === relationshipScope()
      ? displayedRelationships()
      : undefined;
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
    if (relationships.loading) return;
    setPendingAction(action);
    setCursors(nextCursors);
  };
  const retryRelationships = () => {
    setPendingAction(navigationAction());
    void refetch();
  };
  const relationshipRecovery = () => {
    if (!cursors().length) return undefined;
    return relationships.error instanceof ApiError &&
      relationships.error.code === "invalid-cursor"
      ? { label: "First page", action: () => navigate("first", []) }
      : {
          label: "Previous page",
          action: () =>
            navigate("previous", displayedCursors().slice(0, -1)),
        };
  };

  return (
    <div class="relationship-group">
      <div class="relationship-group__header">
        <DisclosureButton
          expanded={expanded()}
          controls={`${key()}-content`}
          onClick={() => app.toggleExpanded(key())}
        >
          <TypeBadge type={props.path.resourceType} />
          <span class="relationship-group__title">
            {identifierLabel(props.path.resourceType)}s
          </span>
        </DisclosureButton>
        <MetaTiming meta={settledRelationships()?.meta} />
      </div>
      <Show when={expanded()}>
        <div id={`${key()}-content`} class="relationship-group__content">
          <Show when={relationships.loading && !settledRelationships()}>
            <LoadingBlock
              label={`relationships page ${formatInteger(cursors().length + 1)}`}
            />
          </Show>
          <Show when={relationships.error}>
            <ErrorBlock
              label={`Relationships page ${formatInteger(cursors().length + 1)} failed`}
              error={relationships.error}
              retry={retryRelationships}
              secondary={relationshipRecovery()}
            />
          </Show>
          <Show when={settledRelationships()}>
            {(envelope: () => ApiSuccess<RelationshipPage>) => (
              <>
                <Pagination
                  page={displayedCursors().length + 1}
                  canPrevious={displayedCursors().length > 0}
                  canNext={envelope().data.pageInfo.hasNextPage}
                  busy={relationships.loading}
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
                <div class="resource-children" aria-busy={relationships.loading}>
                  <For
                    each={envelope().data.items}
                    fallback={<EmptyState>No authorized resources on this page.</EmptyState>}
                  >
                    {(relationship) => (
                      <ResourceNode
                        resource={relationship.resource}
                        ancestry={props.ancestry}
                      />
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ResourceNode(props: {
  resource: EaclObject;
  ancestry: ReadonlySet<string>;
}): JSX.Element {
  const app = useAppState();
  const key = () => resourceKey(props.resource);
  const cycle = () => props.ancestry.has(key());
  const paths = createMemo(
    () => app.bootstrapData()?.data.schema.childPaths[props.resource.type] ?? [],
  );
  const expanded = () => app.isExpanded(`resource:${key()}`);
  const selected = () => resourceKey(app.selectedResource() ?? { type: "", id: "" }) === key();
  const nextAncestry = createMemo(
    () => new Set([...props.ancestry, key()]) as ReadonlySet<string>,
  );

  return (
    <div class={`resource-node ${cycle() ? "resource-node--cycle" : ""}`}>
      <div class="resource-node__row">
        <Show
          when={!cycle() && paths().length > 0}
          fallback={<span class="resource-node__spacer" aria-hidden="true" />}
        >
          <button
            type="button"
            class="resource-node__toggle"
            aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.resource.id}`}
            aria-expanded={expanded()}
            onClick={() => app.toggleExpanded(`resource:${key()}`)}
          >
            {expanded() ? "▾" : "▸"}
          </button>
        </Show>
        <button
          type="button"
          class={`resource-button ${selected() ? "resource-button--active" : ""}`}
          aria-pressed={selected()}
          onClick={() => app.setSelectedResource(props.resource)}
        >
          <TypeBadge type={props.resource.type} />
          <span class="resource-caption">
            <span class="resource-caption__name">
              {identifierLabel(props.resource.id)}
            </span>
            {" "}
            <span class="resource-caption__id">{props.resource.id}</span>
          </span>
        </button>
        <Show when={cycle()}>
          <span class="cycle-badge">cycle</span>
        </Show>
      </div>
      <Show when={expanded() && !cycle()}>
        <div class="resource-node__children">
          <For each={paths()}>
            {(path) => (
              <RelationshipGroup
                parent={props.resource}
                path={path}
                ancestry={nextAncestry()}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ResourceTypeGroup(props: { resourceType: string }): JSX.Element {
  const app = useAppState();
  const groupKey = () => `resource-type:${props.resourceType}`;
  const expanded = () => app.isExpanded(groupKey());
  const pageRequest = new LatestRequest();
  const countRequest = new LatestRequest();
  const [cursors, setCursors] = createSignal<string[]>([]);
  const [countLimit, setCountLimit] = createSignal(initialCountLimit);
  const [settledPageScope, setSettledPageScope] = createSignal("");
  const [displayedPageScope, setDisplayedPageScope] = createSignal("");
  const [observedRangeScope, setObservedRangeScope] = createSignal("");
  const [greatestObservedRangeEnd, setGreatestObservedRangeEnd] = createSignal(0);
  const cursor = () => cursors().at(-1);
  const countScope = () =>
    scopeKey(
      app.subjectId(),
      app.permission(),
      props.resourceType,
      app.activeQueryBasis(),
      JSON.stringify(app.consistency()),
    );
  const resourceScopeFromInput = (input: readonly unknown[]) =>
    scopeKey(input[0], input[1], input[2], input[5], input[8]);
  const base = () =>
    expanded() && app.permission()
      ? ([
          app.subjectId(),
          app.permission(),
          props.resourceType,
          app.cacheEnabled(),
          app.populateCache(),
          app.activeQueryBasis(),
          app.basisGeneration(),
          app.queryGeneration(),
          JSON.stringify(app.consistency()),
        ] as const)
      : false;
  const pageSource = () => {
    const value = base();
    return value
      ? ([...value, app.pageSize(), cursor() ?? "", cursors().length] as const)
      : false;
  };
  const countSource = () => {
    const value = base();
    return value && settledPageScope() === countScope()
      ? ([...value, countLimit()] as const)
      : false;
  };
  const [page, { refetch: refetchPage }] = createResource(pageSource, async (input) => {
    const envelope = await app.runQuery<ObjectPage>(
      pageRequest,
      "/lookup-resources",
      {
        method: "POST",
        body: JSON.stringify({
          subject: { type: "user", id: input[0] },
          permission: input[1],
          resourceType: input[2],
          cache: input[3],
          populateCache: input[4],
          pageSize: input[9],
          after: input[10] || undefined,
          consistency: app.consistency(),
        }),
      },
    );
    return {
      scope: resourceScopeFromInput(input),
      envelope,
      observedRangeEnd: Number(input[11]) * Number(input[9]) + envelope.data.items.length,
    };
  });
  const [count, { refetch: refetchCount }] = createResource(
    countSource,
    async (input) => ({
      scope: resourceScopeFromInput(input),
      envelope: await app.runQuery<ResourceCount>(countRequest, "/count-resources", {
        method: "POST",
        body: JSON.stringify({
          subject: { type: "user", id: input[0] },
          permission: input[1],
          resourceType: input[2],
          cache: input[3],
          populateCache: input[4],
          countLimit: input[9],
          consistency: app.consistency(),
        }),
      }),
    } satisfies ScopedSuccess<ResourceCount>),
  );
  createEffect(() => {
    if (!pageSource()) pageRequest.abort();
    if (!countSource()) countRequest.abort();
  });
  const [displayedPage, setDisplayedPage] = createSignal<ApiSuccess<ObjectPage>>();
  const [displayedCount, setDisplayedCount] =
    createSignal<ApiSuccess<ResourceCount>>();
  const [displayedCountScope, setDisplayedCountScope] = createSignal("");
  const [displayedCursors, setDisplayedCursors] = createSignal<string[]>([]);
  const [displayedPageSize, setDisplayedPageSize] = createSignal(app.pageSize());
  const [pendingPageAction, setPendingPageAction] =
    createSignal<"first" | "previous" | "next">();

  createEffect(() => {
    if (page.loading || page.error) return;
    const result = page();
    if (!result) return;
    setDisplayedPage(result.envelope);
    app.rememberResources(result.envelope.data.items);
    setDisplayedPageScope(result.scope);
    setDisplayedCursors([...cursors()]);
    setDisplayedPageSize(app.pageSize());
    setSettledPageScope(result.scope);
    if (observedRangeScope() === result.scope) {
      setGreatestObservedRangeEnd((current) =>
        Math.max(current, result.observedRangeEnd),
      );
    } else {
      setObservedRangeScope(result.scope);
      setGreatestObservedRangeEnd(result.observedRangeEnd);
    }
  });
  createEffect(() => {
    if (!page.loading) setPendingPageAction(undefined);
  });
  createEffect(() => {
    if (count.loading || count.error) return;
    const result = count();
    if (result) {
      setDisplayedCount(result.envelope);
      setDisplayedCountScope(result.scope);
    }
  });

  createEffect(
    on(
      () => [
        app.subjectId(),
        app.permission(),
        app.pageSize(),
        app.queryGeneration(),
        app.basisGeneration(),
        JSON.stringify(app.consistency()),
      ] as const,
      () => setCursors((current) => (current.length ? [] : current)),
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => countScope(),
      () => setCountLimit(initialCountLimit),
      { defer: true },
    ),
  );
  onCleanup(() => {
    pageRequest.abort();
    countRequest.abort();
  });

  const settledPage = () =>
    displayedPageScope() === countScope() ? displayedPage() : undefined;
  const settledCount = () =>
    displayedCountScope() === countScope() ? displayedCount() : undefined;
  const pageNavigationAction = () => {
    if (cursors().length > displayedCursors().length) return "next" as const;
    if (!cursors().length && displayedCursors().length) return "first" as const;
    if (cursors().length < displayedCursors().length) return "previous" as const;
    return undefined;
  };
  const navigatePage = (
    action: "first" | "previous" | "next",
    nextCursors: string[],
  ) => {
    if (page.loading) return;
    setPendingPageAction(action);
    setCursors(nextCursors);
  };
  const retryPage = () => {
    setPendingPageAction(pageNavigationAction());
    void refetchPage();
  };
  const pageRecovery = () => {
    if (!cursors().length) return undefined;
    return page.error instanceof ApiError && page.error.code === "invalid-cursor"
      ? { label: "First page", action: () => navigatePage("first", []) }
      : {
          label: "Previous page",
          action: () =>
            navigatePage("previous", displayedCursors().slice(0, -1)),
        };
  };
  const itemCount = () => settledPage()?.data.items.length ?? 0;
  const rangeStart = () =>
    itemCount() ? displayedCursors().length * displayedPageSize() + 1 : 0;
  const rangeEnd = () =>
    displayedCursors().length * displayedPageSize() + itemCount();
  const observedRangeEnd = () =>
    observedRangeScope() === countScope()
      ? greatestObservedRangeEnd()
      : rangeEnd();
  const countPresentation = () =>
    resourceCountPresentation(
      settledCount()?.data,
      observedRangeEnd(),
      Boolean(settledPage()?.data.pageInfo.hasNextPage),
    );
  const canIncreaseCount = () =>
    Boolean(settledCount()?.data.truncated) && countLimit() < maximumCountLimit;
  const increaseCount = () => {
    if (count.loading || !canIncreaseCount()) return;
    setCountLimit(nextCountLimit(countLimit()));
  };

  return (
    <div class="group-card">
      <div class="group-card__header">
        <DisclosureButton
          expanded={expanded()}
          controls={`${groupKey()}-content`}
          onClick={() => app.toggleExpanded(groupKey())}
        >
          <TypeBadge type={props.resourceType} />
          <span class="group-card__title">{identifierLabel(props.resourceType)}s</span>
        </DisclosureButton>
        <Show when={expanded()}>
          <div class="group-card__stats">
            <span class="group-card__page-stats">
              <Show
                when={settledPage()}
                fallback={
                  page.loading
                    ? <InlineLoading
                        label={`Loading page ${formatInteger(cursors().length + 1)}`}
                      />
                    : page.error
                      ? <InlineError
                          label={`Page ${formatInteger(cursors().length + 1)} failed`}
                        />
                      : <span class="section-meta">—</span>
                }
              >
                <span class="group-card__range">
                  {formatInteger(rangeStart())}–{formatInteger(rangeEnd())}
                </span>
                <MetaTiming meta={settledPage()?.meta} />
                <Show when={page.loading && !pendingPageAction()}>
                  <InlineLoading label={`Refreshing ${props.resourceType} resources`} />
                </Show>
                <Show when={page.error}>
                  <InlineError
                    label={`Page ${formatInteger(cursors().length + 1)} failed`}
                  />
                </Show>
              </Show>
            </span>
            <span class="group-card__stats-separator">of</span>
            <span class="group-card__count-stats">
              <Show
                when={settledCount()}
                fallback={
                  count.loading
                    ? <InlineLoading label={`Counting ${props.resourceType} resources`} />
                    : count.error
                      ? <InlineError label="Count failed" />
                      : <span class="section-meta">—</span>
                }
              >
                {(envelope: () => ApiSuccess<ResourceCount>) => (
                  <>
                    <Show
                      when={canIncreaseCount()}
                      fallback={
                        <span
                          class="group-card__count"
                          aria-label={countPresentation().truncated
                            ? `At least ${formatInteger(countPresentation().value)} ${props.resourceType} resources`
                            : undefined}
                        >
                          {formatInteger(countPresentation().value)}
                          {countPresentation().truncated ? "+" : ""}
                        </span>
                      }
                    >
                      <button
                        type="button"
                        class="group-card__count group-card__count-action"
                        aria-label={`At least ${formatInteger(countPresentation().value)} ${props.resourceType} resources. Count up to ${formatInteger(nextCountLimit(countLimit()))}`}
                        aria-busy={count.loading}
                        disabled={count.loading}
                        onClick={increaseCount}
                      >
                        {formatInteger(countPresentation().value)}+
                      </button>
                    </Show>
                    <MetaTiming meta={envelope().meta} />
                    <Show when={count.loading}>
                      <InlineLoading label={`Counting ${props.resourceType} resources`} />
                    </Show>
                    <Show when={count.error}>
                      <InlineError label="Count failed" />
                    </Show>
                  </>
                )}
              </Show>
            </span>
          </div>
        </Show>
      </div>

      <Show when={expanded()}>
        <div id={`${groupKey()}-content`} class="group-card__content">
          <Show when={page.loading && !settledPage()}>
            <LoadingBlock
              label={`${props.resourceType} page ${formatInteger(cursors().length + 1)}`}
            />
          </Show>
          <Show when={page.error}>
            <ErrorBlock
              label={`${identifierLabel(props.resourceType)} page ${formatInteger(cursors().length + 1)} failed`}
              error={page.error}
              retry={retryPage}
              secondary={pageRecovery()}
            />
          </Show>
          <Show when={count.error}>
            <ErrorBlock
              label={`${identifierLabel(props.resourceType)} count failed`}
              error={count.error}
              retry={() => void refetchCount()}
            />
          </Show>
          <Show when={settledPage()}>
            {(envelope: () => ApiSuccess<ObjectPage>) => (
              <>
                <Pagination
                  page={displayedCursors().length + 1}
                  canPrevious={displayedCursors().length > 0}
                  canNext={envelope().data.pageInfo.hasNextPage}
                  busy={page.loading}
                  busyAction={pendingPageAction()}
                  first={() => navigatePage("first", [])}
                  previous={() =>
                    navigatePage("previous", displayedCursors().slice(0, -1))
                  }
                  next={() => {
                    const next = envelope().data.pageInfo.endCursor;
                    if (next) navigatePage("next", [...displayedCursors(), next]);
                  }}
                />
                <div class="resource-tree" aria-busy={page.loading}>
                  <For
                    each={envelope().data.items}
                    fallback={<EmptyState>No resources on this page.</EmptyState>}
                  >
                    {(resource) => (
                      <ResourceNode resource={resource} ancestry={new Set()} />
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function ResourceTreePanel(): JSX.Element {
  const app = useAppState();
  const permissions = createMemo(() => {
    const byType = app.bootstrapData()?.data.schema.permissionsByType ?? {};
    return [...new Set(Object.values(byType).flat())].sort();
  });
  return (
    <div class="panel-card resources-panel">
      <h2 class="panel-kicker">Resources</h2>
      <div class="panel-summary">
        <span class="panel-summary__value">{app.subjectId()}</span>
        <span class="panel-summary__separator" aria-hidden="true">
          ·
        </span>
        <span class="panel-summary__value">:{app.permission()}</span>
      </div>
      <section class="panel-section" aria-labelledby="resource-permission-heading">
        <div class="section-header">
          <p id="resource-permission-heading" class="panel-label">Permission</p>
        </div>
        <div class="chip-row">
          <For each={permissions()} fallback={<EmptyState>No permissions defined.</EmptyState>}>
            {(permission) => (
              <button
                type="button"
                class={`chip ${app.permission() === permission ? "chip--active" : ""}`}
                aria-pressed={app.permission() === permission}
                onClick={() => app.setPermission(permission)}
              >
                :{permission}
              </button>
            )}
          </For>
        </div>
      </section>
      <For
        each={app.bootstrapData()?.data.schema.resourceTypes ?? []}
        fallback={<EmptyState>No queryable resource types.</EmptyState>}
      >
        {(resourceType) => <ResourceTypeGroup resourceType={resourceType} />}
      </For>
    </div>
  );
}
