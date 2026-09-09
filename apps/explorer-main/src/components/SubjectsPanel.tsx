import {
  batch,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { LatestRequest } from "../api";
import { useAppState } from "../state";
import type { KnownSubjectPage, ObjectPage } from "../types";
import { ErrorBlock, MetaTiming, Pagination, TypeBadge } from "./Common";

export function SubjectsPanel(props: { onSelect?: () => void }): JSX.Element {
  const app = useAppState();
  const request = new LatestRequest();
  const [type, setType] = createSignal(app.subjectType());
  const [cursors, setCursors] = createSignal<string[]>([]);
  const [page, { refetch }] = createResource(
    () =>
      [
        type(),
        cursors().length,
        cursors().at(-1),
        app.basisGeneration(),
        app.queryGeneration(),
      ] as const,
    async ([kind, index, cursor]) => {
      if (kind === "user") {
        const result = await app.runQuery<KnownSubjectPage>(
          request,
          `/list-subjects?offset=${index * 25}&limit=25`,
        );
        return {
          ...result,
          data: {
            items: result.data.data,
            pageInfo: {
              hasNextPage: result.data.pageInfo.hasNextPage,
              endCursor: String(index + 1),
            },
          },
        };
      }
      return app.runQuery<ObjectPage>(request, "/lookup-resources", {
        method: "POST",
        body: JSON.stringify({
          subject: { type: "user", id: "super-user" },
          resourceType: kind,
          permission: "view",
          pageSize: 25,
          after: cursor,
          cache: app.cacheEnabled(),
          populateCache: app.populateCache(),
          consistency: app.consistency(),
        }),
      });
    },
  );
  onCleanup(() => request.abort());
  const select = (id: string) => {
    batch(() => {
      app.setSubjectType(type());
      app.setSubjectId(id);
    });
    props.onSelect?.();
  };
  return (
    <div class="subjects-panel">
      <label class="picker-type">
        Subject Type{" "}
        <select
          value={type()}
          onChange={(e) =>
            batch(() => {
              setType(e.currentTarget.value);
              setCursors([]);
            })
          }
        >
          <For
            each={[
              ...new Set([
                "user",
                ...(app.bootstrapData()?.data.schema.resourceTypes ?? []),
              ]),
            ]}
          >
            {(kind) => <option>{kind}</option>}
          </For>
        </select>
      </label>
      <Show when={type() === "user"}>
        <div class="chip-row">
          <For each={app.bootstrapData()?.data.quickSubjects ?? []}>
            {(subject) => (
              <button class="subject-button" onClick={() => select(subject.id)}>
                {subject.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={page.error}>
        <ErrorBlock error={page.error} retry={() => void refetch()} />
      </Show>
      <div class="picker-list" aria-busy={page.loading}>
        <For each={page.loading ? [] : (page()?.data.items ?? [])}>
          {(subject) => (
            <button class="list-item" onClick={() => select(subject.id)}>
              <TypeBadge type={subject.type} />
              <code>{subject.id}</code>
            </button>
          )}
        </For>
      </div>
      <div class="picker-page">
        <strong>
          {page()?.data.items.length ? cursors().length * 25 + 1 : 0}–
          {cursors().length * 25 + (page()?.data.items.length ?? 0)}
        </strong>
        <MetaTiming meta={page()?.meta} />
      </div>
      <Pagination
        page={cursors().length + 1}
        canPrevious={cursors().length > 0}
        canNext={page()?.data.pageInfo.hasNextPage ?? false}
        busy={page.loading}
        first={() => setCursors([])}
        previous={() => setCursors((c) => c.slice(0, -1))}
        next={() => {
          const next = page()?.data.pageInfo.endCursor;
          if (next) setCursors((c) => [...c, next]);
        }}
      />
    </div>
  );
}
