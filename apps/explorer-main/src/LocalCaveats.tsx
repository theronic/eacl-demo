import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import "./local-caveats.css";

function Playground() {
  const [backend, setBackend] = createSignal("datomic");
  const [storage, setStorage] = createSignal("");
  const [schema, setSchema] = createSignal("");
  const [subject, setSubject] = createSignal("alice");
  const [resource, setResource] = createSignal("regional");
  const [relation, setRelation] = createSignal("viewer");
  const [permission, setPermission] = createSignal("view");
  const [context, setContext] = createSignal('{"region":"za"}');
  const [caveat, setCaveat] = createSignal("in_region");
  const [bound, setBound] = createSignal('{"accepted":["za"]}');
  const [expiry, setExpiry] = createSignal("");
  const [output, setOutput] = createSignal<any>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [watch, setWatch] = createSignal(false);
  const [cursor, setCursor] = createSignal("");
  const [time, setTime] = createSignal(0);

  async function request(operation: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/local", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: backend(), operation,
        subject: { type: "user", id: subject() }, resource: { type: "doc", id: resource() },
        permission: permission(), relation: relation(), context: JSON.parse(context()), ...extra })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${body.error}\n${body.details ?? ""}`);
    setTime(body.serverTimeMs);
    return body.result;
  }

  async function run(operation: string, extra: Record<string, unknown> = {}) {
    if (busy()) return;
    setBusy(true); setError("");
    try {
      const result = await request(operation, extra);
      setOutput(result);
      if (operation === "resources") setCursor(result["page-info"]?.["has-next-page?"] ? result["page-info"]["end-cursor"] : "");
      if (operation === "info") { setStorage(result.storage); setSchema(result.schema); }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  function write() {
    try {
      const validUntilMs = expiry() ? Date.parse(expiry()) : undefined;
      if (validUntilMs !== undefined && !Number.isFinite(validUntilMs)) throw new Error("Enter a valid expiry.");
      void run("write", { caveat: caveat(), caveatContext: JSON.parse(bound()), validUntilMs });
    } catch (e) { setError(String(e)); }
  }

  function example(name: string) {
    setResource(name); setSubject("alice"); setRelation("viewer"); setPermission("view");
    setCaveat(name === "regional" ? "in_region" : "");
    setExpiry(""); setContext('{"region":"za"}'); setCursor("");
    void run("check");
  }

  onMount(() => {
    void run("info");
    const interval = setInterval(() => { if (watch()) void run("check"); }, 1000);
    onCleanup(() => clearInterval(interval));
  });

  return <main>
    <header><div><p class="eyebrow">EACL · LOCAL DEVELOPMENT</p><h1>Caveats & expiring Relationships <span>v8</span></h1>
      <p>Change request context. Grant temporary access. Watch the decision change.</p></div>
      <label>Backend<select value={backend()} onChange={e => { setBackend(e.currentTarget.value); setCursor(""); void run("info"); }}>
        <option value="datomic">Datomic · :dev transactor</option><option value="datahike">Datahike · S3 / MinIO</option>
      </select></label></header>
    <div class="status">{storage() || "Connecting…"}<span>Storage version 8</span><span>{time() ? `Server time ${new Date(time()).toISOString()}` : ""}</span></div>
    <div class="examples"><strong>Seeded examples</strong>
      <button onClick={() => example("public")}>Unconditional</button>
      <button onClick={() => example("regional")}>Region Caveat</button>
      <button onClick={() => example("temporary")}>60-second grant</button>
      <small>The temporary grant starts at first database creation. Delete and recreate it to renew.</small>
    </div>
    <div class="columns"><section><h2>Check access</h2>
      <div class="fields"><label>User ID<input value={subject()} onInput={e => setSubject(e.currentTarget.value)} /></label>
        <label>Document ID<input value={resource()} onInput={e => setResource(e.currentTarget.value)} /></label>
        <label>Permission<input value={permission()} onInput={e => setPermission(e.currentTarget.value)} /></label></div>
      <label>Request context · JSON<textarea rows={3} value={context()} onInput={e => setContext(e.currentTarget.value)} /></label>
      <p class="hint">Try <code>{'{"region":"za"}'}</code> for access, <code>{'{"region":"us"}'}</code> for denial, or <code>{'{}'}</code> for a conditional result.</p>
      <div class="actions"><button class="primary" disabled={busy()} onClick={() => run("check")}>Check permission</button>
        <label class="checkbox"><input type="checkbox" checked={watch()} onChange={e => setWatch(e.currentTarget.checked)} /> Repeat every second</label></div>
      <div class="actions"><button disabled={busy()} onClick={() => run("resources")}>Lookup documents</button><button disabled={busy()} onClick={() => run("count")}>Count documents</button>
        <button disabled={busy() || !cursor()} onClick={() => run("resources", { after: cursor() })}>Next page</button></div>
      <h2>Relationship</h2><p class="hint">Uses the user and document above. Existing identities must be deleted before replacement.</p>
      <div class="fields"><label>Relation<input value={relation()} onInput={e => setRelation(e.currentTarget.value)} /></label>
        <label>Caveat · optional<input value={caveat()} onInput={e => setCaveat(e.currentTarget.value)} placeholder="Unconditional" /></label></div>
      <label>Bound Caveat context · JSON<textarea rows={2} value={bound()} onInput={e => setBound(e.currentTarget.value)} /></label>
      <label>Expires at · local time, optional<input type="datetime-local" step="1" value={expiry()} onInput={e => setExpiry(e.currentTarget.value)} /></label>
      <div class="actions"><button onClick={() => { const date = new Date(Date.now() + 60000); setExpiry(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)); }}>Set expiry +60s</button>
        <button disabled={busy()} onClick={write}>Create</button><button disabled={busy()} onClick={() => run("delete")}>Delete</button>
        <button disabled={busy()} onClick={() => run("relationships")}>Inspect all</button></div>
    </section><section class="result"><h2>Result <span aria-live="polite">{busy() ? "Running…" : ""}</span></h2>
      <Show when={error()}><pre role="alert" class="error">{error()}</pre></Show>
      <Show when={output()?.permissionship}><div class={`decision ${output().permissionship}`}>{output().permissionship}</div></Show>
      <pre aria-live="polite">{JSON.stringify(output(), (key, value) =>
        (key === "start-cursor" || key === "end-cursor") && value ? "(authenticated cursor)" : value, 2)}</pre>
      <details><summary>Permission schema</summary><textarea aria-label="Permission schema" rows={17} value={schema()} onInput={e => setSchema(e.currentTarget.value)} />
        <button disabled={busy()} onClick={() => run("schema", { schema: schema() })}>Write schema</button></details>
      <p class="hint">Expiry uses the backend request's server clock. Bound Caveat parameters take precedence over request context. Both stores persist across local restarts.</p>
    </section></div>
  </main>;
}

render(() => <Playground />, document.getElementById("root")!);
