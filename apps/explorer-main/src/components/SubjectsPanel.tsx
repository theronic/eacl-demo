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
import { LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import type { ApiSuccess, KnownSubjectPage } from "../types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Pagination,
  TypeBadge,
  identifierLabel,
} from "./Common";

export function SubjectsPanel(): JSX.Element {
  const app = useAppState();
  const request = new LatestRequest();
  const [offset, setOffset] = createSignal(0);
  const source = () =>
    [
      offset(),
      app.pageSize(),
      app.activeQueryBasis(),
      app.basisGeneration(),
      app.queryGeneration(),
    ] as const;
  const [subjects, { refetch }] = createResource(
    source,
    ([currentOffset, pageSize]) =>
      app.runQuery<KnownSubjectPage>(
        request,
        `/api/subjects?offset=${currentOffset}&limit=${pageSize}`,
      ),
  );
  const [displayedSubjects, setDisplayedSubjects] =
    createSignal<ApiSuccess<KnownSubjectPage>>();
  const [displayedOffset, setDisplayedOffset] = createSignal(0);
  const [displayedPageSize, setDisplayedPageSize] = createSignal(app.pageSize());
  const [pendingAction, setPendingAction] =
    createSignal<"first" | "previous" | "next">();

  createEffect(() => {
    if (subjects.loading || subjects.error) return;
    const envelope = subjects();
    if (!envelope) return;
    setDisplayedSubjects(envelope);
    setDisplayedOffset(offset());
    setDisplayedPageSize(app.pageSize());
  });
  createEffect(() => {
    if (!subjects.loading) setPendingAction(undefined);
  });

  createEffect(
    on(
      () => app.pageSize(),
      () => setOffset(0),
      { defer: true },
    ),
  );
  onCleanup(() => request.abort());

  const settledSubjects = displayedSubjects;

  const targetPage = () => Math.floor(offset() / app.pageSize()) + 1;
  const displayedPage = () =>
    Math.floor(displayedOffset() / displayedPageSize()) + 1;
  const navigationAction = () => {
    if (offset() > displayedOffset()) return "next" as const;
    if (offset() === 0 && displayedOffset() > 0) return "first" as const;
    if (offset() < displayedOffset()) return "previous" as const;
    return undefined;
  };
  const navigate = (
    action: "first" | "previous" | "next",
    nextOffset: number,
  ) => {
    if (subjects.loading) return;
    setPendingAction(action);
    setOffset(nextOffset);
  };
  const retry = () => {
    setPendingAction(navigationAction());
    void refetch();
  };

  return (
    <div class="panel-card subjects-panel">
      <h2 class="panel-kicker">Subjects</h2>

      <section class="panel-section" aria-labelledby="quick-subject-heading">
        <div class="section-header">
          <p id="quick-subject-heading" class="panel-label">
            Quick subjects
          </p>
        </div>
        <div class="chip-row">
          <For each={app.bootstrapData()?.data.quickSubjects ?? []}>
            {(subject) => (
              <button
                type="button"
                class={`subject-button ${app.subjectId() === subject.id ? "subject-button--active" : ""}`}
                aria-pressed={app.subjectId() === subject.id}
                onClick={() => app.setSubjectId(subject.id)}
              >
                {subject.label}
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="panel-section" aria-labelledby="known-subject-heading">
        <div class="section-header">
          <p id="known-subject-heading" class="panel-label">
            Known users
          </p>
          <Show when={settledSubjects()?.data.pageInfo.total !== undefined}>
            <span class="section-meta">
              {formatInteger(settledSubjects()?.data.pageInfo.total ?? 0)} total
            </span>
          </Show>
        </div>

        <Show when={subjects.loading && !settledSubjects()}>
          <LoadingBlock label={`subjects page ${formatInteger(targetPage())}`} />
        </Show>
        <Show when={subjects.error}>
          <ErrorBlock
            label={`Subjects page ${formatInteger(targetPage())} failed`}
            error={subjects.error}
            retry={retry}
            secondary={offset() > 0
              ? {
                  label: "Previous page",
                  action: () =>
                    navigate(
                      "previous",
                      Math.max(0, displayedOffset() - displayedPageSize()),
                    ),
                }
              : undefined}
          />
        </Show>
        <Show when={settledSubjects()}>
          {(envelope: () => ApiSuccess<KnownSubjectPage>) => (
            <>
              <Pagination
                page={displayedPage()}
                canPrevious={displayedOffset() > 0}
                canNext={envelope().data.pageInfo.hasNextPage}
                busy={subjects.loading}
                busyAction={pendingAction()}
                first={() => navigate("first", 0)}
                previous={() =>
                  navigate(
                    "previous",
                    Math.max(0, displayedOffset() - displayedPageSize()),
                  )
                }
                next={() =>
                  navigate(
                    "next",
                    envelope().data.pageInfo.nextOffset ?? displayedOffset(),
                  )
                }
              />
              <div class="list-stack" aria-busy={subjects.loading}>
                <For
                  each={envelope().data.data}
                  fallback={<EmptyState>No users on this page.</EmptyState>}
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
                        {" "}
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
    </div>
  );
}
