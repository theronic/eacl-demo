import { For, Show, type JSX } from "solid-js";

import type {
  AuthorizationDecision,
  BackendOption,
  CacheInfo,
  DescriptorNotice,
  ExplorerObject,
  ExplorerRelationship,
  ExplorerSchema,
  StorageChoice
} from "./types";

export function ExplorerHeader(props: { eyebrow?: string; title: string; description: string; actions?: JSX.Element }) {
  return (
    <header class="explorer-header">
      <div>
        <p class="eyebrow">{props.eyebrow ?? "EACL v8 · backend explorer"}</p>
        <h1>{props.title}</h1>
        <p class="lede">{props.description}</p>
      </div>
      <Show when={props.actions}><div class="explorer-header__actions">{props.actions}</div></Show>
    </header>
  );
}

export function ThemeControl(props: { value: "system" | "light" | "dark"; onChange: (theme: "system" | "light" | "dark") => void }) {
  return (
    <label class="theme-control"><span>Theme</span><select aria-label="Color theme" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value as "system" | "light" | "dark")}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
  );
}

export function ProfileSelector(props: {
  backends: BackendOption[];
  backend: string;
  storage: string;
  storageChoices: StorageChoice[];
  onBackend: (id: string) => void;
  onStorage: (id: string) => void;
}) {
  const storageChoice = (storage: string) => props.storageChoices.find((choice) => choice.storage === storage);
  return (
    <section class="selector-card" aria-labelledby="profile-selector-heading">
      <div class="section-heading">
        <h2 id="profile-selector-heading">Backend &amp; storage</h2>
      </div>
      <div class="selectors">
        <label>
          <span>Backend</span>
          <select value={props.backend} onChange={(event) => props.onBackend(event.currentTarget.value)}>
            <For each={props.backends}>{(backend) => <option value={backend.id}>{backend.label}</option>}</For>
          </select>
        </label>
        <label>
          <span>Storage</span>
          <select
            value={props.storage}
            onChange={(event) => {
              const choice = storageChoice(event.currentTarget.value);
              if (choice?.selectable) props.onStorage(choice.storage);
            }}
          >
            <For each={props.storageChoices}>{(choice) => (
              <option value={choice.storage} disabled={!choice.selectable}>{choice.label}</option>
            )}</For>
          </select>
        </label>
      </div>
    </section>
  );
}

export function PanelBoundary(props: {
  id: string;
  title: string;
  summary?: string;
  busy?: boolean;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section class="panel-card" data-panel-id={props.id} aria-labelledby={`${props.id}-heading`} aria-busy={props.busy === true}>
      <div class="panel-heading">
        <div><h2 id={`${props.id}-heading`} tabindex="-1">{props.title}</h2><Show when={props.summary}><p>{props.summary}</p></Show></div>
        <Show when={props.actions}><div class="panel-actions">{props.actions}</div></Show>
      </div>
      <div class="panel-content">{props.children}</div>
    </section>
  );
}

export function LoadingState(props: { label: string; elapsed?: string; onCancel?: () => void }) {
  return (
    <div class="async-state" role="status" aria-live="polite" aria-atomic="true">
      <span class="spinner" aria-hidden="true" />
      <p>{props.label}<Show when={props.elapsed}> <span>({props.elapsed})</span></Show></p>
      <Show when={props.onCancel}><button type="button" class="button button--quiet" onClick={() => props.onCancel?.()}>Cancel</button></Show>
    </div>
  );
}

export function LiveAnnouncer(props: { announcement: { id: string; politeness: "polite" | "assertive"; message: string } | null }) {
  return (
    <div class="visually-hidden" aria-live={props.announcement?.politeness ?? "polite"} aria-atomic="true" data-announcement-id={props.announcement?.id ?? "none"}>
      {props.announcement?.message ?? ""}
    </div>
  );
}

export function ErrorState(props: { title?: string; message: string; code?: string; retryable?: boolean; onRetry?: () => void }) {
  return (
    <div class="error-state" role="alert">
      <div><strong>{props.title ?? "This panel could not load."}</strong><p>{props.message}</p><Show when={props.code}><code>{props.code}</code></Show></div>
      <Show when={props.retryable && props.onRetry}><button type="button" class="button" onClick={() => props.onRetry?.()}>Retry</button></Show>
    </div>
  );
}

export function EmptyState(props: { children: JSX.Element }) {
  return <p class="empty-state">{props.children}</p>;
}

export function CursorPagination(props: {
  label: string;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  busy?: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav class="pagination" aria-label={`${props.label} pagination`} aria-busy={props.busy === true}>
      <button type="button" class="button button--quiet" disabled={!props.hasPrevious || props.busy} onClick={props.onFirst}>First</button>
      <button type="button" class="button button--quiet" disabled={!props.hasPrevious || props.busy} onClick={props.onPrevious}>Previous</button>
      <span aria-live="polite" aria-atomic="true">Page {props.page}</span>
      <button type="button" class="button button--quiet" disabled={!props.hasNext || props.busy} onClick={props.onNext}>Next</button>
    </nav>
  );
}

export function SubjectSelector(props: {
  subjects: ExplorerObject[];
  subjectId: string | null;
  permissions: string[];
  permission: string | null;
  onSubject: (subject: ExplorerObject) => void;
  onPermission: (permission: string) => void;
}) {
  return (
    <div class="subject-selector">
      <fieldset><legend>Subject</legend><div class="choice-list">
        <For each={props.subjects}>{(subject) => <button type="button" class="choice-button" aria-pressed={props.subjectId === subject.id} onClick={() => props.onSubject(subject)}>{subject.displayName ?? subject.id}<small>{subject.type}/{subject.id}</small></button>}</For>
      </div></fieldset>
      <fieldset><legend>Permission</legend><div class="choice-list">
        <For each={props.permissions}>{(permission) => <button type="button" class="choice-button" aria-pressed={props.permission === permission} onClick={() => props.onPermission(permission)}>{permission}</button>}</For>
      </div></fieldset>
    </div>
  );
}

export function ObjectList(props: { objects: ExplorerObject[]; selected?: { type: string; id: string } | null; onSelect: (object: ExplorerObject) => void }) {
  return (
    <Show when={props.objects.length > 0} fallback={<EmptyState>No objects were returned for this bounded page.</EmptyState>}>
      <ul class="object-list">
        <For each={props.objects}>{(object) => (
          <li><button type="button" aria-pressed={props.selected?.type === object.type && props.selected?.id === object.id} onClick={() => props.onSelect(object)}><span>{object.displayName ?? object.id}</span><small>{object.type}/{object.id}</small></button></li>
        )}</For>
      </ul>
    </Show>
  );
}

export function ObjectDetail(props: { object: ExplorerObject }) {
  return (
    <article class="object-detail">
      <h3>{props.object.displayName ?? props.object.id}</h3>
      <p><code>{props.object.type}/{props.object.id}</code></p>
      <Show when={props.object.attributes.length > 0} fallback={<EmptyState>This object has no public attributes.</EmptyState>}>
        <dl class="fact-list"><For each={props.object.attributes}>{(attribute) => <><dt>{attribute.name}</dt><dd>{formatScalar(attribute.value)}</dd></>}</For></dl>
      </Show>
    </article>
  );
}

export function RelationshipList(props: { relationships: ExplorerRelationship[]; onOpenSubject?: (type: string, id: string) => void }) {
  return (
    <Show when={props.relationships.length > 0} fallback={<EmptyState>No relationships were returned for this bounded page.</EmptyState>}>
      <ul class="relationship-list"><For each={props.relationships}>{(relationship) => (
        <li>
          <code>{relationship.resourceType}/{relationship.resourceId}</code>
          <span aria-label={`relation ${relationship.relation}`}>— {relationship.relation} →</span>
          <button type="button" disabled={!props.onOpenSubject} onClick={() => props.onOpenSubject?.(relationship.subjectType, relationship.subjectId)}>
            {relationship.subjectType}/{relationship.subjectId}{relationship.subjectRelation ? `#${relationship.subjectRelation}` : ""}
          </button>
        </li>
      )}</For></ul>
    </Show>
  );
}

export function AuthorizationResult(props: { decision: AuthorizationDecision }) {
  return (
    <article class="authorization-result" data-allowed={props.decision.allowed}>
      <h3>{props.decision.permission}: {props.decision.allowed ? "Allowed" : "Denied"}</h3>
      <p><code>{props.decision.subjectType}/{props.decision.subjectId}</code> on <code>{props.decision.resourceType}/{props.decision.resourceId}</code></p>
      <p>Reason: {props.decision.reasonCode}</p>
      <ol><For each={props.decision.path}>{(step) => <li data-allowed={step.allowed}><span>{step.label}</span><small>{step.kind}</small></li>}</For></ol>
    </article>
  );
}

export function SchemaView(props: { schema: ExplorerSchema }) {
  return (
    <div class="schema-view">
      <p>Schema digest <code>{props.schema.sha256}</code></p>
      <For each={props.schema.types}>{(type) => (
        <section aria-labelledby={`schema-type-${safeId(type.name)}`}>
          <h3 id={`schema-type-${safeId(type.name)}`}>{type.name}</h3>
          <div class="table-scroll" tabindex="0" role="region" aria-label={`${type.name} schema details`}>
            <table><thead><tr><th scope="col">Kind</th><th scope="col">Name</th><th scope="col">Definition</th></tr></thead><tbody>
              <For each={type.relations}>{(relation) => <tr><td>Relation</td><th scope="row">{relation.name}</th><td>{relation.subjectTypes.join(", ")}</td></tr>}</For>
              <For each={type.permissions}>{(permission) => <tr><td>Permission</td><th scope="row">{permission.name}</th><td><code>{permission.expression}</code></td></tr>}</For>
            </tbody></table>
          </div>
        </section>
      )}</For>
    </div>
  );
}

export function CacheView(props: { cache: CacheInfo }) {
  return (
    <div class="cache-view">
      <dl class="fact-list"><dt>Behavior</dt><dd>{props.cache.behavior}</dd><dt>Scope</dt><dd>{props.cache.scope}</dd><dt>Request result</dt><dd>{props.cache.hit === null ? "Not reported" : props.cache.hit ? "Hit" : "Miss"}</dd><dt>Entries</dt><dd>{props.cache.entries ?? "Not reported"}</dd></dl>
      <LimitationList limitations={props.cache.limitations.map((text) => ({ id: text, label: text, description: "" }))} />
    </div>
  );
}

export function ConsistencySelector(props: {
  modes: Array<{ id: string; label: string; description: string }>;
  value: string;
  onChange: (mode: string) => void;
  limitations?: DescriptorNotice[];
}) {
  return (
    <fieldset class="consistency-selector">
      <legend>Consistency</legend>
      <div class="radio-list"><For each={props.modes}>{(mode) => (
        <label><input type="radio" name="consistency" value={mode.id} checked={props.value === mode.id} onChange={() => props.onChange(mode.id)} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span></label>
      )}</For></div>
      <LimitationList limitations={props.limitations ?? []} />
    </fieldset>
  );
}

export function LimitationList(props: { limitations: DescriptorNotice[] }) {
  return <Show when={props.limitations.length > 0}><div class="limitations"><h3>Limitations</h3><ul><For each={props.limitations}>{(limitation) => <li><strong>{limitation.label}</strong><Show when={limitation.description}><span>{limitation.description}</span></Show></li>}</For></ul></div></Show>;
}

function safeId(value: string) { return value.replace(/[^A-Za-z0-9_-]/gu, "-"); }
function formatScalar(value: string | number | boolean | null) { return value === null ? "null" : typeof value === "string" ? value : JSON.stringify(value); }
