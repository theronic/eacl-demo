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
import { LatestRequest } from "../api";
import { formatInteger } from "../format";
import { useAppState } from "../state";
import type { SchemaInfo } from "../types";
import {
  ButtonSpinner,
  DisclosureButton,
  ErrorBlock,
  InlineError,
  InlineLoading,
  LoadingBlock,
} from "./Common";

const SchemaGraph = lazy(() => import("./SchemaGraph"));

export function SchemaPanel(): JSX.Element {
  const app = useAppState();
  const request = new LatestRequest();
  const writeRequest = new LatestRequest();
  const [schema, { mutate, refetch }] = createResource(
    () => [
      app.activeQueryBasis(),
      app.basisGeneration(),
      app.queryGeneration(),
    ] as const,
    () => app.runQuery<SchemaInfo>(request, "/api/schema"),
  );
  const [displayedSchema, setDisplayedSchema] = createSignal<
    ReturnType<typeof schema>
  >();
  const [draft, setDraft] = createSignal("");
  const [committed, setCommitted] = createSignal("");
  const [writeError, setWriteError] = createSignal<unknown>();
  const [writing, setWriting] = createSignal(false);
  const expansionKey = "segment:schema";
  const expanded = () => app.isExpanded(expansionKey);
  const writable = () => Boolean(app.bootstrapData()?.data.capabilities.schemaWrite);
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
      const result = await writeRequest.run<SchemaInfo>("/api/schema", {
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
      <div class={`panel-card panel-card--graph ${expanded() ? "" : "panel-card--collapsed"}`}>
        <div class="panel-heading schema-shell__header">
          <DisclosureButton
            expanded={expanded()}
            controls="schema-segment-content"
            onClick={() => app.toggleExpanded(expansionKey)}
          >
            <span class="group-card__title">
              Schema
              <Show when={settledSchema()}>
                {(envelope) => (
                  <> ({formatInteger(envelope().data.resourceCount)} resources, {" "}
                    {formatInteger(envelope().data.relationCount)} relations, {" "}
                    {formatInteger(envelope().data.permissionCount)} permissions)
                  </>
                )}
              </Show>
            </span>
          </DisclosureButton>
          <Show when={schema.loading}>
            <InlineLoading label="Loading schema" />
          </Show>
          <Show when={schema.error}>
            <InlineError label="Schema unavailable" />
          </Show>
          <Show when={!schema.loading && !schema.error && !writing() && draft() !== committed()}>
            <span class="section-meta" role="status">
              Unsaved changes
            </span>
          </Show>
        </div>
        <Show when={expanded()}>
          <div id="schema-segment-content" class="schema-panel">
            <section class="schema-panel__pane">
              <div class="section-header">
                <div>
                  <p class="section-meta">
                    {writable() ? "Edit the schema and click Write Schema" : "Read-only public demo"}
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
                <div class="schema-preset-tabs" role="tablist" aria-label="Schema presets">
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
                <textarea
                  id="schema-editor"
                  class="schema-editor"
                  aria-label="Spice Schema"
                  spellcheck={false}
                  readOnly={!writable() || writing()}
                  value={draft()}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                />
                <div class="schema-panel__actions">
                  <Show when={writeError()}>
                    {(error) => <ErrorBlock label="Schema write failed" error={error()} />}
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
            <section class="schema-panel__pane">
              <div class="section-header">
                <div>
                  <p class="panel-label">Schema Graph</p>
                  <p class="section-meta">Resources, permissions, and relation paths</p>
                </div>
              </div>
              <div class="graph-canvas">
                <Suspense fallback={<LoadingBlock label="schema graph" />}>
                  <Show when={settledSchema()}>
                    {(envelope) => (
                      <SchemaGraph
                        nodes={envelope().data.nodes}
                        links={envelope().data.links}
                      />
                    )}
                  </Show>
                </Suspense>
              </div>
            </section>
          </div>
        </Show>
      </div>
    </section>
  );
}
