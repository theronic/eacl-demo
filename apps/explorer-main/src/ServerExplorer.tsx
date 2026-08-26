import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";

import clientRequestSchema from "../../../schemas/explorer-client-request.v1.schema.json";
import errorCodesSchema from "../../../schemas/error-codes.v1.schema.json";
import explorerSchema from "../../../schemas/explorer.v1.schema.json";
import responseSchema from "../../../schemas/explorer-response.v1.schema.json";
import { createRuntimeBoundaryValidator } from "../../../packages/contracts/src/runtime-validation.mjs";
import { projectDescriptorPresentation } from "../../../packages/explorer-state/src/descriptor-presentation.mjs";
import { createExplorerController } from "../../../packages/explorer-state/src/explorer-controller.mjs";
import { createExplorerOperations } from "../../../packages/explorer-state/src/explorer-operations.mjs";
import { createServerProfileTransport } from "../../../packages/explorer-state/src/http-transport.mjs";
import {
  AuthorizationResult,
  CacheView,
  ConsistencySelector,
  CursorPagination,
  EmptyState,
  ErrorState,
  LiveAnnouncer,
  LoadingState,
  ObjectDetail,
  ObjectList,
  PanelBoundary,
  RelationshipList,
  SchemaView
} from "../../../packages/ui/src/components";
import type { AuthorizationDecision, CacheInfo, ExplorerObject, ExplorerRelationship, ExplorerSchema } from "../../../packages/ui/src/types";

export interface ExplorerProfile {
  id: string;
  backend: string;
  storage: string;
  state: "enabled";
  reason: null;
  route: string;
  deployment: {
    demoSha: string;
    eaclSha: string;
    artifact: { kind: "static" | "lambda-version" | "browser-worker"; sha256: string; version: string };
    deploymentId: string;
    dataManifestSha256: string;
    deployedAt: string;
  };
}

const schemas = { clientRequestSchema, errorCodesSchema, explorerSchema, responseSchema };
const validateRequest = createRuntimeBoundaryValidator(
  schemas,
  "https://demo.eacl.dev/schemas/explorer-client-request.v1.schema.json",
  "serverClientRequest"
);
const validateResponse = createRuntimeBoundaryValidator(
  schemas,
  "https://demo.eacl.dev/schemas/explorer-response.v1.schema.json",
  "serverResponse"
);

export default function ServerExplorer(props: { profile: ExplorerProfile; transportFactory?: (profile: ExplorerProfile, context: { epoch: number; signal: AbortSignal }) => any }) {
  const [explorerState, setExplorerState] = createSignal<any>(null);
  const [operationState, setOperationState] = createSignal<any>(null);
  const [subjectType, setSubjectType] = createSignal("user");
  const [subjectId, setSubjectId] = createSignal("user-1");
  const [resourceType, setResourceType] = createSignal("server");
  const [resourceId, setResourceId] = createSignal("server-1");
  const [permission, setPermission] = createSignal("view");
  const [relation, setRelation] = createSignal("owner");
  const [relationships, setRelationships] = createSignal<ExplorerRelationship[] | null>(null);
  const [reverseObjects, setReverseObjects] = createSignal<ExplorerObject[] | null>(null);
  const [decision, setDecision] = createSignal<AuthorizationDecision | null>(null);
  const [relationshipBusy, setRelationshipBusy] = createSignal(false);
  const [reverseBusy, setReverseBusy] = createSignal(false);
  const [authorizationBusy, setAuthorizationBusy] = createSignal(false);
  const [countBusy, setCountBusy] = createSignal(false);
  const [relationshipError, setRelationshipError] = createSignal<string | null>(null);
  const [reverseError, setReverseError] = createSignal<string | null>(null);
  const [authorizationError, setAuthorizationError] = createSignal<string | null>(null);
  const [countError, setCountError] = createSignal<string | null>(null);

  const controller: any = (createExplorerController as any)({
    initialPreferences: { consistencyMode: "current", pageSize: 25 },
    onState: setExplorerState,
    transportFactory: (profile: ExplorerProfile, context: { epoch: number; signal: AbortSignal }) => props.transportFactory
      ? props.transportFactory(profile, context)
      : createServerProfileTransport({
        profile,
        baseUrl: window.location.href,
        validateRequest,
        validateResponse
      })
  });
  setExplorerState(controller.getState());
  const operations: any = (createExplorerOperations as any)({ controller, onState: setOperationState });
  setOperationState(operations.getState());
  let activeIdentity = "";

  createEffect(() => {
    const profile = props.profile;
    const identity = `${profile.id}:${profile.deployment.deploymentId}:${profile.deployment.artifact.sha256}:${profile.deployment.dataManifestSha256}`;
    if (identity === activeIdentity) return;
    activeIdentity = identity;
    void activate(profile, identity);
  });
  onCleanup(() => { void controller.close(); });

  const descriptor = createMemo(() => explorerState()?.descriptor ?? null);
  const presentation = createMemo<any>(() => descriptor() ? projectDescriptorPresentation(descriptor()) : null);
  const subjectPager = createMemo(() => operationState()?.pagers?.["subjects:all"] ?? null);
  const subjectsPanel = createMemo(() => explorerState()?.panels?.subjects ?? null);
  const objectPanel = createMemo(() => explorerState()?.panels?.["object-detail"] ?? null);
  const schemaPanel = createMemo(() => explorerState()?.panels?.schema ?? null);
  const cachePanel = createMemo(() => explorerState()?.panels?.cache ?? null);
  const count = createMemo(() => operationState()?.counts?.[`objects:${resourceType()}`] ?? null);
  const relationshipPagerKey = createMemo(() => `relationships:${resourceType()}:${resourceId()}:${relation() || "all"}`);
  const reversePagerKey = createMemo(() => `reverse:${subjectType()}:${subjectId()}:${relation() || "all"}`);
  const relationshipPager = createMemo(() => operationState()?.pagers?.[relationshipPagerKey()] ?? null);
  const reversePager = createMemo(() => operationState()?.pagers?.[reversePagerKey()] ?? null);

  async function activate(profile: ExplorerProfile, identity: string) {
    resetLocalResults();
    try {
      const result = await controller.switchProfile(profile);
      if (result.outcome !== "ready" || identity !== activeIdentity) return;
      operations.reset();
      const subjects = await operations.listSubjects();
      if (subjects.outcome === "success" && subjects.value.items[0]) {
        setSubjectType(subjects.value.items[0].type);
        setSubjectId(subjects.value.items[0].id);
      }
      await Promise.allSettled([
        operations.getSchema(),
        operations.getCacheInfo(),
        loadCount(false)
      ]);
    } catch {
      // The controller exposes a redacted startup error and owns retry state.
    }
  }

  function resetLocalResults() {
    setRelationships(null);
    setReverseObjects(null);
    setDecision(null);
    setRelationshipError(null);
    setReverseError(null);
    setAuthorizationError(null);
    setCountError(null);
  }

  async function loadRelationships(direction: "first" | "next" | "previous" = "first") {
    setRelationshipBusy(true);
    setRelationshipError(null);
    try {
      const result = await operations.listRelationships({ resourceType: resourceType(), resourceId: resourceId(), relation: relation() || null, direction });
      if (result.outcome === "success") setRelationships(result.value.items);
      else if (result.outcome === "failure") setRelationshipError(result.error.message);
    } catch (error) {
      setRelationshipError(publicMessage(error));
    } finally {
      setRelationshipBusy(false);
    }
  }

  async function loadReverseRelationships(direction: "first" | "next" | "previous" = "first") {
    setReverseBusy(true);
    setReverseError(null);
    try {
      const result = await operations.reverseRelationships({ subjectType: subjectType(), subjectId: subjectId(), relation: relation() || null, direction });
      if (result.outcome === "success") setReverseObjects(result.value.items);
      else if (result.outcome === "failure") setReverseError(result.error.message);
    } catch (error) {
      setReverseError(publicMessage(error));
    } finally {
      setReverseBusy(false);
    }
  }

  async function authorize() {
    setAuthorizationBusy(true);
    setAuthorizationError(null);
    try {
      const result = await operations.authorize({ subjectType: subjectType(), subjectId: subjectId(), resourceType: resourceType(), resourceId: resourceId(), permission: permission() });
      if (result.outcome === "success") setDecision(result.value);
      else if (result.outcome === "failure") setAuthorizationError(result.error.message);
    } catch (error) {
      setAuthorizationError(publicMessage(error));
    } finally {
      setAuthorizationBusy(false);
    }
  }

  async function loadCount(escalate: boolean) {
    setCountBusy(true);
    setCountError(null);
    try {
      const result = await operations.countObjects({ kind: "objects", type: resourceType(), escalate });
      if (result.outcome === "failure") setCountError(result.error.message);
    } catch (error) {
      setCountError(publicMessage(error));
    } finally {
      setCountBusy(false);
    }
  }

  return (
    <section class="server-explorer" aria-label={`${props.profile.backend} ${props.profile.storage} explorer`}>
      <LiveAnnouncer announcement={explorerState()?.announcement ?? null} />
      <Show when={explorerState()?.status === "switching"}>
        <PanelBoundary id="profile-startup" title="Starting selected profile" summary="Cold and restored environments remain cancellable while their exact descriptor is verified." busy>
          <LoadingState label={`Initializing ${props.profile.id}`} elapsed={formatElapsed(explorerState()?.startup?.elapsedMs)} onCancel={() => { void controller.cancelStartup(); }} />
        </PanelBoundary>
      </Show>
      <Show when={explorerState()?.status === "error" || explorerState()?.status === "canceled"}>
        <PanelBoundary id="profile-startup-failure" title="Selected profile is not ready">
          <ErrorState message={explorerState()?.error?.message ?? "Profile initialization was canceled."} code={explorerState()?.error?.code} retryable onRetry={() => { void controller.retryProfile(); }} />
        </PanelBoundary>
      </Show>
      <Show when={explorerState()?.status === "ready" && presentation()}>{(facts) => <>
        <Show when={facts().controls.consistency}>
          <PanelBoundary id="consistency" title="Read basis">
            <ConsistencySelector modes={facts().consistency.modes} value={explorerState().preferences.consistencyMode} onChange={(mode) => controller.setPreferences({ consistencyMode: mode })} />
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.subjects}>
          <PanelBoundary id="subjects" title="Subjects" summary="Browse one bounded cursor page at a time." busy={subjectsPanel()?.phase === "loading"} actions={<button type="button" class="button button--quiet" onClick={() => { void operations.listSubjects(); }}>Reload first page</button>}>
            <PanelFeedback panel={subjectsPanel()} onCancel={() => operations.cancel("subjects")} onRetry={() => { void controller.retryPanel("subjects"); }} />
            <Show when={subjectsPanel()?.phase === "ready" && subjectPager()?.value ? subjectPager() : null}>{(pager) => <>
              <ObjectList objects={pager().value.items} selected={{ type: subjectType(), id: subjectId() }} onSelect={(subject) => { setSubjectType(subject.type); setSubjectId(subject.id); }} />
              <CursorPagination label="Subjects" page={pager().page} hasPrevious={pager().index > 0} hasNext={pager().pageInfo.hasNextPage} onFirst={() => { void operations.listSubjects({ direction: "first" }); }} onPrevious={() => { void operations.listSubjects({ direction: "previous" }); }} onNext={() => { void operations.listSubjects({ direction: "next" }); }} />
            </>}</Show>
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.objects}>
          <PanelBoundary id="object-inspector" title="Object lookup and bounded count" summary="Open one normalized object; counts advance only through explicit ceilings." busy={objectPanel()?.phase === "loading" || countBusy()}>
            <form class="explorer-form" onSubmit={(event) => { event.preventDefault(); void operations.getObject({ type: resourceType(), id: resourceId() }); }}>
              <TextField label="Resource type" value={resourceType()} onInput={(value) => { setResourceType(value); setRelationships(null); setReverseObjects(null); setCountError(null); }} />
              <TextField label="Resource ID" value={resourceId()} onInput={(value) => { setResourceId(value); setRelationships(null); }} />
              <button type="submit" class="button">Open object</button>
              <button type="button" class="button button--quiet" onClick={() => { void loadCount(true); }}>Increase count ceiling</button>
            </form>
            <PanelFeedback panel={objectPanel()} onCancel={() => operations.cancel("object-detail")} onRetry={() => { void controller.retryPanel("object-detail"); }} />
            <Show when={countBusy()}><LoadingState label="Counting to the current explicit ceiling." onCancel={() => operations.cancelCount({ kind: "objects", type: resourceType() })} /></Show>
            <Show when={countError()}>{(message) => <ErrorState message={message()} retryable onRetry={() => { void loadCount(false); }} />}</Show>
            <Show when={objectPanel()?.phase === "ready"}><ObjectDetail object={objectPanel().value.object} /></Show>
            <Show when={count()}>{(value) => <p class="count-result">Counted <strong>{value().value.toLocaleString()}</strong> {resourceType()} objects. {value().exact ? "Exact." : `Truncated at ${value().ceiling.toLocaleString()}.`}</p>}</Show>
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.relationships || facts().controls.reverseRelationships}>
          <PanelBoundary id="relationship-explorer" title="Relationships" summary="Expand outbound or reverse edges without exposing an arbitrary query surface." busy={relationshipBusy() || reverseBusy()}>
            <form class="explorer-form" onSubmit={(event) => { event.preventDefault(); void loadRelationships(); }}>
              <TextField label="Relation" value={relation()} onInput={(value) => { setRelation(value); setRelationships(null); setReverseObjects(null); }} />
              <button type="submit" class="button" disabled={!facts().controls.relationships}>Load outbound</button>
              <button type="button" class="button button--quiet" disabled={!facts().controls.reverseRelationships} onClick={() => { void loadReverseRelationships(); }}>Load reverse</button>
            </form>
            <Show when={relationshipError()}>{(message) => <ErrorState message={message()} />}</Show>
            <Show when={reverseError()}>{(message) => <ErrorState message={message()} />}</Show>
            <Show when={relationships()}>{(items) => <RelationshipList relationships={items()} onOpenSubject={(type, id) => { setSubjectType(type); setSubjectId(id); }} />}</Show>
            <Show when={relationships() && relationshipPager()}>{(pager) => <CursorPagination label="Outbound relationships" page={pager().page} hasPrevious={pager().index > 0} hasNext={pager().pageInfo?.hasNextPage === true} busy={relationshipBusy()} onFirst={() => { void loadRelationships("first"); }} onPrevious={() => { void loadRelationships("previous"); }} onNext={() => { void loadRelationships("next"); }} />}</Show>
            <Show when={reverseObjects()}>{(items) => <ObjectList objects={items()} onSelect={(object) => { setResourceType(object.type); setResourceId(object.id); }} />}</Show>
            <Show when={reverseObjects() && reversePager()}>{(pager) => <CursorPagination label="Reverse relationships" page={pager().page} hasPrevious={pager().index > 0} hasNext={pager().pageInfo?.hasNextPage === true} busy={reverseBusy()} onFirst={() => { void loadReverseRelationships("first"); }} onPrevious={() => { void loadReverseRelationships("previous"); }} onNext={() => { void loadReverseRelationships("next"); }} />}</Show>
            <Show when={relationshipBusy()}><LoadingState label="Loading outbound relationships." onCancel={() => operations.cancel(relationshipPagerKey())} /></Show>
            <Show when={reverseBusy()}><LoadingState label="Loading reverse relationships." onCancel={() => operations.cancel(reversePagerKey())} /></Show>
            <Show when={relationships() === null && reverseObjects() === null && !relationshipError() && !reverseError()}><EmptyState>Choose an edge direction to load a bounded page.</EmptyState></Show>
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.authorization}>
          <PanelBoundary id="authorization" title="Authorization decision" summary="Evaluate one explicit subject, resource, and permission." busy={authorizationBusy()}>
            <form class="explorer-form explorer-form--wide" onSubmit={(event) => { event.preventDefault(); void authorize(); }}>
              <TextField label="Subject type" value={subjectType()} onInput={setSubjectType} />
              <TextField label="Subject ID" value={subjectId()} onInput={setSubjectId} />
              <TextField label="Permission" value={permission()} onInput={setPermission} />
              <button type="submit" class="button">Check permission</button>
            </form>
            <Show when={authorizationError()}>{(message) => <ErrorState message={message()} />}</Show>
            <Show when={decision()}>{(value) => <AuthorizationResult decision={value()} />}</Show>
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.schema}>
          <PanelBoundary id="schema" title="Schema" busy={schemaPanel()?.phase === "loading"} actions={<button type="button" class="button button--quiet" onClick={() => { void operations.getSchema(); }}>Reload</button>}>
            <PanelFeedback panel={schemaPanel()} onCancel={() => operations.cancel("schema")} onRetry={() => { void controller.retryPanel("schema"); }} />
            <Show when={schemaPanel()?.phase === "ready"}><SchemaView schema={schemaPanel().value as ExplorerSchema} /></Show>
          </PanelBoundary>
        </Show>

        <Show when={facts().controls.cache}>
          <PanelBoundary id="cache" title="Cache" busy={cachePanel()?.phase === "loading"} actions={<button type="button" class="button button--quiet" onClick={() => { void operations.getCacheInfo(); }}>Refresh</button>}>
            <PanelFeedback panel={cachePanel()} onCancel={() => operations.cancel("cache")} onRetry={() => { void controller.retryPanel("cache"); }} />
            <Show when={cachePanel()?.phase === "ready"}><CacheView cache={cachePanel().value as CacheInfo} /></Show>
          </PanelBoundary>
        </Show>
      </>}</Show>
    </section>
  );
}

function PanelFeedback(props: { panel: any; onCancel: () => void; onRetry: () => void }) {
  return <>
    <Show when={props.panel?.phase === "loading"}><LoadingState label="Loading bounded data." onCancel={props.onCancel} /></Show>
    <Show when={props.panel?.phase === "error"}><ErrorState message={props.panel.error.message} code={props.panel.error.code} retryable={props.panel.retryable} onRetry={props.onRetry} /></Show>
    <Show when={props.panel?.phase === "canceled"}><ErrorState title="Request canceled." message="The settled data in other panels was retained." retryable onRetry={props.onRetry} /></Show>
  </>;
}

function TextField(props: { label: string; value: string; onInput: (value: string) => void }) {
  return <label><span>{props.label}</span><input value={props.value} maxlength={256} autocomplete="off" onInput={(event) => props.onInput(event.currentTarget.value)} /></label>;
}

function formatElapsed(value: number | undefined) {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : undefined;
}

function publicMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 512) : "The explorer request failed.";
}
