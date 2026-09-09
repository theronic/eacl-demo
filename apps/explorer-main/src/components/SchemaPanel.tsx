import {
  createEffect,
  createResource,
  createSignal,
  For,
  lazy,
  onCleanup,
  Show,
  Suspense,
  type JSX,
} from "solid-js";
import { SchemaSource } from "./SchemaSource";
import { LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import type { SchemaInfo } from "../types";
import {
  ButtonSpinner,
  ErrorBlock,
  InlineError,
  InlineLoading,
  LoadingBlock,
} from "./Common";

const SchemaGraph = lazy(() => import("./SchemaGraph"));

export function SchemaPanel(props: { view: string }): JSX.Element {
  const [inlineGraphOpen, setInlineGraphOpen] = createSignal(false);
  const [inlineGraphVisited, setInlineGraphVisited] = createSignal(false);
  const [focusedType, setFocusedType] = createSignal("server");
  const [focusedMember, setFocusedMember] = createSignal<string>();
  const [focusedKind, setFocusedKind] = createSignal<
    "relation" | "permission"
  >();
  const [focusVersion, setFocusVersion] = createSignal(0);
  const focusDefinition = (
    type: string,
    member?: string,
    kind?: "relation" | "permission",
  ) => {
    setFocusedMember(member);
    setFocusedKind(kind);
    setFocusVersion((value) => value + 1);
    setFocusedType(type);
    setInlineGraphVisited(true);
    setInlineGraphOpen(true);
  };
  const [graphVisited, setGraphVisited] = createSignal(false);
  createEffect(() => {
    if (props.view === "graph") setGraphVisited(true);
  });
  const app = useAppState();
  const request = new LatestRequest();
  const writeRequest = new LatestRequest();
  const [schema, { mutate, refetch }] = createResource(
    () =>
      [
        app.activeQueryBasis(),
        app.basisGeneration(),
        app.queryGeneration(),
      ] as const,
    () => app.runQuery<SchemaInfo>(request, "/get-schema"),
  );
  const [displayedSchema, setDisplayedSchema] =
    createSignal<ReturnType<typeof schema>>();
  const [draft, setDraft] = createSignal("");
  const [committed, setCommitted] = createSignal("");
  const [writeError, setWriteError] = createSignal<unknown>();
  const [writing, setWriting] = createSignal(false);
  const writable = () =>
    Boolean(app.bootstrapData()?.data.capabilities.schemaWrite);
  const settledSchema = displayedSchema;

  createEffect(() => {
    if (schema.loading || schema.error) return;
    const envelope = schema();
    if (envelope) setDisplayedSchema(envelope);
  });

  createEffect(() => {
    const source = settledSchema()?.data.source;
    if (source === undefined) return;
    if (!committed() || draft() === committed()) setDraft(source);
    setCommitted(source);
  });
  onCleanup(() => {
    request.abort();
    writeRequest.abort();
  });

  const writeSchema = async () => {
    setWriting(true);
    setWriteError(undefined);
    try {
      const result = await writeRequest.run<SchemaInfo>("/get-schema", {
        method: "PUT",
        body: JSON.stringify({ source: draft() }),
      });
      mutate(result);
      setCommitted(result.data.source);
      setDraft(result.data.source);
      app.applyMutationRevision(result.meta.revision);
      app.refetchBootstrap();
    } catch (error) {
      setWriteError(error);
    } finally {
      setWriting(false);
    }
  };

  return (
    <section class="schema-shell">
      <div class="panel-card panel-card--graph">
        <div class="panel-heading schema-shell__header">
          <h2 class="schema-heading">
            <span class="group-card__title">
              Schema
              <Show when={settledSchema()}>
                {(envelope) => (
                  <>
                    {" "}
                    ({formatInteger(
                      envelope().data.resourceCount,
                    )} resources, {formatInteger(envelope().data.relationCount)}{" "}
                    relations, {formatInteger(envelope().data.permissionCount)}{" "}
                    permissions)
                  </>
                )}
              </Show>
            </span>
          </h2>
          <Show when={schema.loading}>
            <InlineLoading label="Loading schema" />
          </Show>
          <Show when={schema.error}>
            <InlineError label="Schema unavailable" />
          </Show>
          <Show
            when={
              !schema.loading &&
              !schema.error &&
              !writing() &&
              draft() !== committed()
            }
          >
            <span class="section-meta" role="status">
              Unsaved changes
            </span>
          </Show>
        </div>
        <div id="schema-segment-content" class="schema-panel">
          <section class="schema-panel__pane" hidden={props.view !== "schema"}>
            <div class="section-header">
              <div>
                <p class="section-meta">
                  {writable()
                    ? "Edit the schema and click Write Schema"
                    : "Read-only public demo"}
                </p>
              </div>
            </div>
            <Show when={schema.loading && !settledSchema()}>
              <LoadingBlock label="schema" />
            </Show>
            <Show when={schema.error}>
              <ErrorBlock
                label="Schema request failed"
                error={schema.error}
                retry={() => void refetch()}
              />
            </Show>
            <Show when={settledSchema()}>
              <div
                class="schema-preset-tabs"
                role="tablist"
                aria-label="Schema presets"
              >
                <For each={settledSchema()?.data.presets ?? []}>
                  {(preset) => (
                    <button
                      type="button"
                      role="tab"
                      class={`schema-preset-tab ${draft() === preset.schema ? "schema-preset-tab--active" : ""}`}
                      aria-selected={draft() === preset.schema}
                      disabled={!writable() || writing()}
                      onClick={() => setDraft(preset.schema)}
                    >
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
              <div class="schema-inline-graph-toggle">
                <button
                  type="button"
                  class="pagination-button"
                  aria-expanded={inlineGraphOpen()}
                  aria-controls="inline-schema-graph"
                  onClick={() => {
                    if (!inlineGraphOpen()) setInlineGraphVisited(true);
                    setInlineGraphOpen((value) => !value);
                  }}
                >
                  {inlineGraphOpen()
                    ? "Hide Schema Graph"
                    : "Show Schema Graph"}
                </button>
                <span class="section-meta">
                  Select a definition to focus its graph.
                </span>
              </div>
              <div
                class="schema-source-workspace"
                classList={{
                  "schema-source-workspace--open": inlineGraphOpen(),
                }}
              >
                <div class="schema-source-workspace__source">
                  <Show
                    when={writable()}
                    fallback={
                      <SchemaSource
                        source={draft()}
                        selected={inlineGraphOpen() ? focusedType() : undefined}
                        selectedMember={focusedMember()}
                        onSelect={focusDefinition}
                      />
                    }
                  >
                    <textarea
                      id="schema-editor"
                      class="schema-editor"
                      aria-label="Spice Schema"
                      spellcheck={false}
                      readOnly={!writable() || writing()}
                      value={draft()}
                      onInput={(event) => setDraft(event.currentTarget.value)}
                      onClick={(event) => {
                        const editor = event.currentTarget;
                        const start =
                          editor.value.lastIndexOf(
                            "\n",
                            editor.selectionStart - 1,
                          ) + 1;
                        const line = editor.value.slice(start).split("\n")[0];
                        const definition = line.match(
                          /^definition\s+([A-Za-z_]\w*)\s*\{/,
                        );
                        if (
                          definition &&
                          settledSchema()?.data.nodes.some(
                            (node) => node.id === definition[1],
                          )
                        )
                          focusDefinition(definition[1]);
                      }}
                    />
                  </Show>
                </div>
                <Show when={inlineGraphVisited()}>
                  <aside
                    id="inline-schema-graph"
                    class="schema-inline-graph"
                    hidden={!inlineGraphOpen()}
                    aria-label="Focused Schema Graph"
                  >
                    <div class="section-header">
                      <strong>
                        {focusedType()}
                        {focusedMember() ? `.${focusedMember()}` : ""}
                      </strong>
                    </div>
                    <Suspense fallback={<LoadingBlock label="schema graph" />}>
                      <Show when={settledSchema()}>
                        {(envelope) => (
                          <SchemaGraph
                            source={envelope().data.source}
                            nodes={envelope().data.nodes}
                            links={envelope().data.links}
                            focusType={focusedType()}
                            focusMember={focusedMember()}
                            focusKind={focusedKind()}
                            focusVersion={focusVersion()}
                            embedded
                          />
                        )}
                      </Show>
                    </Suspense>
                  </aside>
                </Show>
              </div>
              <div class="schema-panel__actions">
                <Show when={writeError()}>
                  {(error) => (
                    <ErrorBlock label="Schema write failed" error={error()} />
                  )}
                </Show>
                <Show when={writable()}>
                  <button
                    type="button"
                    class="pagination-button"
                    disabled={writing() || !draft() || draft() === committed()}
                    aria-busy={writing()}
                    onClick={() => void writeSchema()}
                  >
                    <Show when={writing()}>
                      <ButtonSpinner />
                    </Show>
                    Write Schema
                  </button>
                </Show>
              </div>
            </Show>
          </section>
          <Show when={graphVisited()}>
            <section class="schema-panel__pane" hidden={props.view !== "graph"}>
              <div class="section-header">
                <div>
                  <p class="panel-label">Schema Graph</p>
                  <p class="section-meta">
                    Resources, permissions, and relation paths
                  </p>
                </div>
              </div>
              <Show when={schema.loading && !settledSchema()}>
                <LoadingBlock label="schema" />
              </Show>
              <Show when={schema.error}>
                <ErrorBlock
                  label="Schema request failed"
                  error={schema.error}
                  retry={() => void refetch()}
                />
              </Show>
              <div class="graph-canvas">
                <Suspense fallback={<LoadingBlock label="schema graph" />}>
                  <Show when={settledSchema()}>
                    {(envelope) => (
                      <SchemaGraph
                        source={envelope().data.source}
                        nodes={envelope().data.nodes}
                        links={envelope().data.links}
                      />
                    )}
                  </Show>
                </Suspense>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </section>
  );
}
