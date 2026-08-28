import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
  type JSX,
} from "solid-js";
import { ApiError } from "../api";
import type {
  ApiSuccess,
  ConsistencyRequest,
  EaclObject,
  PermissionDecision,
} from "../types";
import { ButtonSpinner, MetaTiming } from "./Common";

export interface CanPermissionQuery {
  subject: EaclObject;
  permission: string;
  resource: EaclObject;
}

export interface CanPermissionFooterProps {
  subjectTypes: readonly string[];
  subjects: Accessor<readonly EaclObject[]>;
  resourceTypes: readonly string[];
  resources: Accessor<readonly EaclObject[]>;
  permissionsByType: Readonly<Record<string, readonly string[]>>;
  initial: CanPermissionQuery;
  query: (
    input: CanPermissionQuery,
    options: { cache: boolean; populateCache: boolean; consistency: ConsistencyRequest },
  ) => Promise<ApiSuccess<PermissionDecision>>;
  cache: Accessor<boolean>;
  populateCache: Accessor<boolean>;
  consistency: Accessor<ConsistencyRequest>;
}

/** Reusable, controlled-data EACL can? console for any Explorer transport. */
export function CanPermissionFooter(props: CanPermissionFooterProps): JSX.Element {
  const [subjectType, setSubjectType] = createSignal(props.initial.subject.type);
  const [subjectId, setSubjectId] = createSignal(props.initial.subject.id);
  const [resourceType, setResourceType] = createSignal(props.initial.resource.type);
  const [resourceId, setResourceId] = createSignal(props.initial.resource.id);
  const [permission, setPermission] = createSignal(props.initial.permission);
  const [result, setResult] = createSignal<ApiSuccess<PermissionDecision>>();
  const [error, setError] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(false);
  const [manualGeneration, setManualGeneration] = createSignal(0);
  let querySequence = 0;
  let timer: number | undefined;

  const permissions = createMemo(() => props.permissionsByType[resourceType()] ?? []);
  const subjectIds = createMemo(() => props.subjects()
    .filter((subject) => subject.type === subjectType())
    .map((subject) => subject.id));
  const resourceIds = createMemo(() => props.resources()
    .filter((resource) => resource.type === resourceType())
    .map((resource) => resource.id));
  const valid = () => Boolean(
    subjectType() && subjectId() && resourceType() && resourceId() && permission(),
  );

  const execute = async () => {
    if (!valid()) {
      setResult(undefined);
      setError(new Error("Choose a subject, permission, and resource before querying."));
      return;
    }
    const sequence = ++querySequence;
    setLoading(true);
    setError(undefined);
    try {
      const envelope = await props.query({
        subject: { type: subjectType(), id: subjectId() },
        permission: permission(),
        resource: { type: resourceType(), id: resourceId() },
      }, {
        cache: props.cache(),
        populateCache: props.populateCache(),
        consistency: props.consistency(),
      });
      if (sequence === querySequence) setResult(envelope);
    } catch (cause) {
      if (sequence === querySequence && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setResult(undefined);
        setError(cause);
      }
    } finally {
      if (sequence === querySequence) setLoading(false);
    }
  };

  createEffect(() => {
    resourceType();
    const available = permissions();
    if (!available.includes(permission())) setPermission(available[0] ?? "");
  });

  createEffect(() => {
    subjectType();
    subjectId();
    resourceType();
    resourceId();
    permission();
    props.cache();
    props.populateCache();
    JSON.stringify(props.consistency());
    manualGeneration();
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => void execute(), 175);
  });

  onCleanup(() => {
    querySequence += 1;
    if (timer !== undefined) window.clearTimeout(timer);
  });

  const errorMessage = () => {
    const cause = error();
    if (cause instanceof ApiError) return `${cause.code}: ${cause.message}`;
    return cause instanceof Error ? cause.message : String(cause);
  };

  return (
    <aside class="can-permission-footer" aria-label="Arbitrary EACL permission check">
      <div class="can-permission-footer__query">
        <code class="can-permission-footer__function">(eacl/can?</code>
        <span class="can-permission-footer__group">
          <span class="can-permission-footer__label">Subject:</span>
          <select aria-label="can? subject type" value={subjectType()} onChange={(event) => setSubjectType(event.currentTarget.value)}>
            <For each={props.subjectTypes}>{(type) => <option value={type}>{type}</option>}</For>
          </select>
          <input
            aria-label="can? subject ID"
            list="can-permission-subject-ids"
            value={subjectId()}
            onInput={(event) => setSubjectId(event.currentTarget.value)}
          />
          <datalist id="can-permission-subject-ids">
            <For each={subjectIds()}>{(id) => <option value={id} />}</For>
          </datalist>
        </span>
        <select aria-label="can? permission" value={permission()} onChange={(event) => setPermission(event.currentTarget.value)}>
          <For each={permissions()}>{(name) => <option value={name}>{name}</option>}</For>
        </select>
        <span class="can-permission-footer__group">
          <span class="can-permission-footer__label">Resource:</span>
          <select aria-label="can? resource type" value={resourceType()} onChange={(event) => setResourceType(event.currentTarget.value)}>
            <For each={props.resourceTypes}>{(type) => <option value={type}>{type}</option>}</For>
          </select>
          <input
            aria-label="can? resource ID"
            list="can-permission-resource-ids"
            value={resourceId()}
            onInput={(event) => setResourceId(event.currentTarget.value)}
          />
          <datalist id="can-permission-resource-ids">
            <For each={resourceIds()}>{(id) => <option value={id} />}</For>
          </datalist>
        </span>
        <code class="can-permission-footer__function">)</code>
        <span class="can-permission-footer__decision" aria-live="polite">
          =&gt; <Show when={result()} fallback="—">
            {(envelope) => <strong class={envelope().data.allowed ? "decision-allowed" : "decision-denied"}>{String(envelope().data.allowed)}</strong>}
          </Show>
        </span>
        <MetaTiming meta={result()?.meta} />
        <button
          type="button"
          class="can-permission-footer__button"
          disabled={loading() || !valid()}
          aria-busy={loading()}
          onClick={() => setManualGeneration((value) => value + 1)}
        >
          <Show when={loading()}><ButtonSpinner /></Show>
          Query
        </button>
      </div>
      <Show when={error()}>
        <p class="can-permission-footer__error" role="alert">{errorMessage()}</p>
      </Show>
    </aside>
  );
}
