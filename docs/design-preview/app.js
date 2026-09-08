// Design shell over the unmodified canonical EACL DataScript runtime.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icons = {
  shield: '<path d="M12 3 20 6v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  tree: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M6 13h12V9"/>',
  schema: '<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="7" height="6" rx="1"/><rect x="15" y="16" width="7" height="6" rx="1"/><path d="M12 8v4H5v4m7-4h7v4"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  density: '<path d="M4 5h16M4 12h16M4 19h16M7 3v4M17 10v4M7 17v4"/>',
  account: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 6"/>',
  vpc: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v5H5v3m7-3h7v3"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M6 6.5h.1M6 17.5h.1M10 6.5h7m-7 11h7"/>',
  platform: '<path d="m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6"/>',
  layers: '<path d="m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.server}</svg>`;
const hydrateIcons = () => $$('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
const typeNames = { account: 'Accounts', team: 'Teams', vpc: 'VPCs', server: 'Servers', platform: 'Platforms' };
const quickSubjects = ['user-1', 'user-2', 'super-user'];
const owner = crypto.randomUUID();
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('eacl-design-v2')) || {}; } catch { /* Optional cosmetic preferences. */ }
const requestedTheme = new URLSearchParams(location.search).get('theme');
const state = {
  principal: 'user-1', permission: 'view', selected: null, reversePermission: 'view',
  backend: 'datascript', storage: 'browser-memory', execution: 'browser', ready: false,
  epoch: 0, inspectorEpoch: 0, checkEpoch: 0, expanded: new Set(['root:account']), pages: new Map(),
  focusKey: 'root:account', filter: '', filterOverrides: new Map(), compact: preferences.compact === true, view: 'explorer',
  cache: true, populateCache: true, hits: 0, misses: 0, disabled: 0, activity: [],
  decisions: {}, reverse: null, subjects: { items: [], cursor: null, history: [], index: 0 },
  theme: ['light', 'dark'].includes(requestedTheme) ? requestedTheme : preferences.theme === 'dark' ? 'dark' : 'light',
};
let metadata, bootstrap, schema, treeNodes = new Map(), previousDialogFocus, toastTimer;
const connected = () => state.ready && state.backend === 'datascript';
const permissions = (type) => schema?.types.find((entry) => entry.name === type)?.permissions || [];
const supports = (type, permission) => permissions(type).some((entry) => entry.name === permission);
const pageSize = () => Number($('#page-size').value);
const cacheInput = () => ({ cache: state.cache, populateCache: state.populateCache, consistency: 'minimize' });
const authInput = (type, id, permission = state.permission, principal = state.principal) => ({
  subjectType: 'user', subjectId: principal, resourceType: type, ...(id ? { resourceId: id } : {}), permission,
});
const ms = (value) => typeof value === 'number' && Number.isFinite(value) ? `${value < 0.01 ? '<0.01' : value.toFixed(2)} ms` : '—';
const cacheBadge = (meta) => `<span class="cache-badge ${escapeHtml(meta?.cacheStatus || 'unreported')}">${escapeHtml(meta?.cacheStatus || 'not reported')}</span>`;
function evidence(meta, label = '') {
  if (!meta) return '<span class="unmeasured">Not queried</span>';
  return `<span class="operation-evidence" title="${escapeHtml(`${label}\nRequest: ${meta.requestId}\nBasis: ${meta.revision}`)}">${label ? `<small>${escapeHtml(label)}</small>` : ''}<b>${ms(meta.elapsedMs)}</b>${cacheBadge(meta)}</span>`;
}
function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  $('#announcement').textContent = message; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function updateCounters() {
  $('#cache-hits').textContent = state.hits; $('#cache-misses').textContent = state.misses;
  $('#cache-other').textContent = `${state.disabled} disabled`; $('#activity-count').textContent = state.activity.length;
}
async function request(operation, input = {}, epoch = state.epoch) {
  if (!connected()) throw new Error('This profile is not connected in the local design preview.');
  const response = await window.EaclDataScriptRuntime.request(operation, input, crypto.randomUUID(), owner);
  if (epoch === state.epoch) {
    const { meta } = response;
    state.activity.unshift({ operation, input, ...response }); state.activity = state.activity.slice(0, 100);
    if (meta?.cacheStatus === 'hit') state.hits++;
    if (meta?.cacheStatus === 'miss') state.misses++;
    if (meta?.cacheStatus === 'disabled') state.disabled++;
    if (['lookup-resources', 'lookup-subjects', 'count-resources', 'check-permission'].includes(operation)) {
      $('#latest-latency').textContent = ms(meta?.elapsedMs);
      $('#latest-operation').textContent = `${operation} · ${meta?.cacheStatus || 'cache not reported'}`;
    }
    updateCounters(); if (state.view === 'activity') renderActivity();
  }
  if (response.error) { const error = new Error(response.error.message); error.meta = response.meta; throw error; }
  return response;
}
function savePreferences() {
  try { localStorage.setItem('eacl-design-v2', JSON.stringify({ theme: state.theme, compact: state.compact })); } catch { /* Optional cosmetic preferences. */ }
}
function applyTheme() {
  savePreferences();
  document.documentElement.dataset.theme = state.theme;
  $('#theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`);
}
function renderEnvironment() {
  const { catalog } = metadata;
  const storageLabel = (id) => catalog.storages.find((entry) => entry.id === id).label;
  // Mirror the production selector, whose public backend list excludes Jank.
  $('#backend-options').innerHTML = catalog.backends.filter((entry) => entry.id !== 'jank').map((entry) =>
    `<button class="backend-card ${entry.id === state.backend ? 'active' : ''}" data-backend="${entry.id}" aria-pressed="${entry.id === state.backend}"><span class="radio-dot"></span><span><strong>${entry.label}</strong><small>${entry.storages.map(storageLabel).join(' / ')}</small></span>${entry.id === 'datascript' ? '<span class="live-pill">LOCAL</span>' : ''}</button>`).join('');
  const backend = catalog.backends.find((entry) => entry.id === state.backend);
  $('#storage-options').innerHTML = backend.storages.map((id) => `<button class="choice ${id === state.storage ? 'active' : ''}" data-storage="${id}" aria-pressed="${id === state.storage}">${storageLabel(id)}</button>`).join('');
  const activeExecution = metadata.platforms[`${state.backend}/${state.storage}`];
  const allExecution = [metadata.platforms['datascript/browser-memory'][0], ...metadata.platforms['datomic/dynamodb']].map((entry) => activeExecution.find((option) => option.id === entry.id) || { ...entry, selectable: false, reason: entry.id === 'browser' ? 'Select DataScript for browser execution.' : 'Select a server backend for this execution option.' });
  $('#execution-options').innerHTML = allExecution.map((entry) => `<button class="choice ${entry.id === state.execution ? 'active' : ''}" data-execution="${entry.id}" aria-pressed="${entry.id === state.execution}" ${entry.selectable ? '' : 'disabled'} title="${escapeHtml(entry.reason || entry.label)}">${escapeHtml(entry.label)}</button>`).join('');
  $('.performance-title strong').textContent = connected() ? 'Live query evidence' : 'Query evidence';
  $('.performance-title small').textContent = connected() ? 'Local DataScript · operation latency' : 'Connect a profile to measure latency';
  $('.performance-title .status-dot').hidden = !connected();
  $('#runtime-status').innerHTML = connected() ? '<span class="status-dot"></span>Live in your browser' : state.backend === 'datascript' ? 'Starting local DataScript…' : '<span class="offline-pill">Layout preview</span> This profile is not connected locally';
  const modes = [
    ['Minimize latency', 'Use the available local basis', 'minimize-latency'],
    ['At least as fresh', 'Set a relative or absolute freshness floor', 'at-least-as-fresh'],
    ['Exact snapshot', 'Read an immutable snapshot at a chosen time', 'at-exact-snapshot'],
    ['Fully consistent', 'Require an authoritative current read', 'fully-consistent'],
  ];
  $('#consistency-options').innerHTML = modes.map(([title, detail, id], index) => `<button class="consistency-card ${index === 0 && connected() ? 'active' : ''}" ${index > 0 || !connected() ? 'disabled' : ''} aria-pressed="${index === 0 && connected()}" title="${index === 0 ? detail : 'Unavailable in this local DataScript preview; support comes from the active runtime descriptor.'}" data-consistency="${id}"><span class="radio-dot"></span><span><strong>${title}</strong><small>${detail}</small>${index > 0 ? '<em>Unavailable in this local runtime</em>' : '<em>minimize-latency</em>'}</span></button>`).join('');
  $('#basis-summary').innerHTML = connected() ? `<span class="basis-label">PAGE-LIFECYCLE BASIS</span><code title="${escapeHtml(bootstrap.basis.id)}">${escapeHtml(bootstrap.basis.id.split(':').at(-1))}</code><span>Historical / external synchronization unavailable</span>` : 'Select DataScript for live local queries. Server-profile connections remain part of the connected implementation.';
  $('#requery').disabled = !connected();
  $('#check-form button[type=submit]').disabled = !connected();
}
function resetScope() {
  state.epoch++; state.inspectorEpoch++; state.checkEpoch++; state.pages.clear(); state.selected = null;
  state.expanded = new Set([...state.expanded].filter((key) => !key.includes('/'))); state.filterOverrides.clear();
  state.decisions = {}; state.reverse = null; state.hits = 0; state.misses = 0; state.disabled = 0; state.activity = [];
  $('#latest-latency').textContent = '—'; $('#latest-operation').textContent = 'Waiting for a query';
  $('#check-result').textContent = 'Ready to check · latency and cache outcome appear here.';
  updateCounters(); renderExplorer(); renderActivity();
  for (const type of resourceTypes()) if (isOpen(`root:${type}`)) loadGroup({ kind: 'root', key: `root:${type}`, type });
}
function setPrincipal(id) {
  state.principal = id; $('#principal-name').textContent = id;
  $('.principal-trigger .avatar').textContent = id === 'super-user' ? 'SU' : id === 'user-1' ? 'U1' : id === 'user-2' ? 'U2' : 'U';
  resetScope(); notify(`Exploring as ${id}. Previous resource selection cleared.`);
}
function resourceTypes() { return schema?.types.filter((type) => type.permissions.length).map((type) => type.name) || []; }
function relationships(resource) {
  return schema.types.flatMap((type) => type.relations.filter((relation) => relation.subjectTypes.includes(resource.type)).map((relation) => ({ type: type.name, relation: relation.name })));
}
const isOpen = (key) => state.filter ? state.filterOverrides.get(key) ?? state.expanded.has(key) : state.expanded.has(key);
function resourceNode(resource, parent, ancestors) {
  const identity = `${resource.type}:${resource.id}`;
  return { key: `${parent}/object:${identity}`, kind: 'resource', type: resource.type, label: resource.id, resource, ancestors: [...ancestors, identity], cycle: ancestors.includes(identity) };
}
function children(node) {
  if (node.kind === 'resource') return node.cycle ? [] : relationships(node.resource).map((group) => ({
    key: `${node.key}/relation:${group.type}:${group.relation}`, kind: 'relation', label: typeNames[group.type], ...group, resource: node.resource, ancestors: node.ancestors,
  }));
  return (state.pages.get(node.key)?.items || []).map((resource) => resourceNode(resource, node.key, node.ancestors || []));
}
async function loadGroup(node, direction = 'first') {
  if (!connected() || (node.kind !== 'root' && node.kind !== 'relation')) return;
  if (!supports(node.type, state.permission)) return;
  const previous = state.pages.get(node.key);
  if (previous?.loading) return;
  const epoch = state.epoch;
  const history = direction === 'next' ? [...(previous?.history || []), previous?.cursor || null] : [...(previous?.history || [])];
  const cursor = direction === 'next' ? previous?.pageInfo?.endCursor : direction === 'previous' ? history.pop() : null;
  if (direction === 'first') history.length = 0;
  const page = { items: [], loading: true, history, cursor, count: previous?.count, countMeta: previous?.countMeta };
  state.pages.set(node.key, page); renderTree();
  try {
    if (node.kind === 'root') {
      const query = { ...authInput(node.type), ...cacheInput() };
      const response = await request('lookup-resources', { ...query, pageSize: pageSize(), ...(cursor ? { cursor } : {}) }, epoch);
      if (epoch !== state.epoch) return;
      Object.assign(page, response.data, { meta: response.meta });
      if (direction === 'first') {
        try {
          const count = await request('count-resources', { ...query, ceiling: 1000 }, epoch);
          if (epoch !== state.epoch) return;
          page.count = count.data; page.countMeta = count.meta; page.countError = null;
        } catch (error) { page.countError = error.message; }
      }
    } else {
      const response = await request('reverse-relationships', { subjectType: node.resource.type, subjectId: node.resource.id, relation: node.relation, pageSize: pageSize(), ...(cursor ? { cursor } : {}), ...cacheInput() }, epoch);
      if (epoch !== state.epoch) return;
      page.meta = response.meta; page.pageInfo = response.data.pageInfo;
      page.checks = [];
      for (const resource of response.data.items.filter((item) => item.type === node.type)) {
        const decision = await request('check-permission', { ...authInput(resource.type, resource.id), ...cacheInput() }, epoch);
        if (epoch !== state.epoch) return;
        page.checks.push(decision.meta);
        if (decision.data.allowed) page.items.push(resource);
      }
    }
  } catch (error) { if (epoch === state.epoch) { page.error = error.message; page.meta = error.meta; } }
  if (epoch === state.epoch) { page.loading = false; renderTree(); }
}
function disclosure(open) { return `<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="3"/><path d="M5 9h8${open ? '' : 'M9 5v8'}"/></svg>`; }
function nodeHtml(node, level = 1, parent = null) {
  const page = state.pages.get(node.key);
  const childNodes = children(node);
  const query = state.filter.trim().toLowerCase();
  const matches = node.label?.toLowerCase().includes(query);
  const childHtml = childNodes.map((child) => nodeHtml(child, level + 1, node.key)).join('');
  if (query && node.kind === 'resource' && !matches && !childHtml.includes('resource-row')) return '';
  treeNodes.set(node.key, { ...node, parent, level });
  const expandable = !node.cycle && (node.kind !== 'resource' || childNodes.length > 0);
  const filterReveal = !!query && childHtml.includes('resource-row') && !state.filterOverrides.has(node.key);
  const open = expandable && (isOpen(node.key) || filterReveal);
  const selected = node.kind === 'resource' && state.selected?.type === node.type && state.selected?.id === node.resource.id;
  const key = escapeHtml(node.key);
  const permissionSupported = supports(node.type, state.permission);
  const count = page?.count ? `${page.count.value.toLocaleString()}${page.count.exact ? '' : '+'}` : page?.loading ? '…' : '—';
  return `<li role="treeitem" class="tree-item" data-key="${key}" aria-level="${level}" ${expandable ? `aria-expanded="${open}"` : ''} ${node.kind === 'resource' ? `aria-selected="${selected}"` : ''} aria-label="${escapeHtml(node.label || typeNames[node.type])}${node.cycle ? ', cycle boundary' : ''}" tabindex="${node.key === state.focusKey ? 0 : -1}">
    <div class="tree-row ${node.kind}-row ${selected ? 'selected' : ''}" style="--level:${level}">
      <div class="tree-identity"><button class="disclosure" tabindex="-1" data-toggle="${key}" aria-label="${open ? 'Collapse' : 'Expand'} ${escapeHtml(node.label || typeNames[node.type])}" ${expandable ? '' : 'disabled'}>${disclosure(open)}</button><span class="resource-symbol ${node.type}">${node.kind === 'relation' ? '↳' : icon(node.type)}</span><button class="row-label" tabindex="-1" ${node.kind === 'resource' ? `data-select="${key}"` : `data-toggle="${key}"`}><strong>${escapeHtml(node.label || typeNames[node.type])}</strong>${node.kind === 'relation' ? `<small>via :${node.relation}</small>` : node.kind === 'root' ? `<small>${node.type} · lookup-resources</small>` : ''}</button>${node.cycle ? '<span class="cycle-label">cycle ↩</span>' : ''}</div>
      <span class="count-column">${node.kind === 'root' ? `<b>${permissionSupported ? count : 'N/A'}</b>${page?.count ? '<small>count-resources</small>' : ''}` : node.kind === 'relation' && page ? `<b>${page.items.length}</b><small>in this page</small>` : selected ? '✓' : ''}</span>
      <span class="timing-column">${node.kind !== 'resource' ? (page?.loading ? '<span class="loading-label">Querying…</span>' : evidence(page?.meta, node.kind === 'root' ? 'lookup' : 'traverse')) + (node.kind === 'root' && page?.countMeta ? evidence(page.countMeta, 'count') : '') : ''}</span>
    </div>
    ${open ? `<ul role="group">${!permissionSupported ? '<li role="none" class="tree-hint">This type has no such permission in the canonical schema.</li>' : page?.error ? `<li role="none" class="tree-hint error">${escapeHtml(page.error)} <button class="text-button" data-retry="${key}">Retry from first page</button></li>` : node.kind === 'resource' ? childHtml : `${page?.checks ? `<li role="none" class="traversal-evidence">Authorization checks: ${page.checks.length} · ${ms(page.checks.reduce((sum, meta) => sum + meta.elapsedMs, 0))} total · ${page.checks.filter((meta) => meta.cacheStatus === 'hit').length} hits / ${page.checks.filter((meta) => meta.cacheStatus === 'miss').length} misses${page.checks.some((meta) => meta.cacheStatus === 'disabled') ? ' · cache disabled' : ''}</li>` : ''}${childHtml}${page && !page.loading && !page.items.length ? '<li role="none" class="tree-hint">No authorized results in this page.</li>' : ''}${page?.countError ? `<li role="none" class="tree-hint error">Count unavailable: ${escapeHtml(page.countError)}</li>` : ''}${page && !page.loading ? `<li role="none" class="pagination"><span>Page ${page.history.length + 1} · ${page.items.length} loaded</span><button class="text-button" data-page="first" data-group="${key}" ${page.history.length ? '' : 'disabled'}>First</button><button class="text-button" data-page="previous" data-group="${key}" ${page.history.length ? '' : 'disabled'}>Previous</button><button class="text-button" data-page="next" data-group="${key}" ${page.pageInfo?.hasNextPage ? '' : 'disabled'}>Next →</button></li>` : ''}`}</ul>` : ''}
  </li>`;
}
function renderTree() {
  const container = $('#resource-tree'); const top = container.scrollTop;
  const focused = container.contains(document.activeElement) ? document.activeElement.closest('[data-key]')?.dataset.key : null;
  treeNodes = new Map();
  container.innerHTML = !connected() ? '<div class="empty-tree"><strong>Profile layout preview</strong><p>Select DataScript to explore the original fixture with live local EACL queries.</p></div>' : `<ul role="group">${resourceTypes().map((type) => nodeHtml({ kind: 'root', type, key: `root:${type}`, label: typeNames[type] })).join('')}</ul>`;
  container.classList.toggle('compact', state.compact); container.scrollTop = top;
  const visible = visibleTreeItems();
  if (!visible.some((item) => item.dataset.key === state.focusKey)) state.focusKey = visible[0]?.dataset.key;
  visible.forEach((item) => { item.tabIndex = item.dataset.key === state.focusKey ? 0 : -1; });
  container.tabIndex = visible.length ? -1 : 0;
  if (focused) focusTree(visible.some((item) => item.dataset.key === focused) ? focused : state.focusKey, false);
}
function visibleTreeItems() { return $$('[role=treeitem]', $('#resource-tree')); }
function focusTree(key, scroll = true) {
  const element = visibleTreeItems().find((item) => item.dataset.key === key);
  if (element) { state.focusKey = key; visibleTreeItems().forEach((item) => { item.tabIndex = item === element ? 0 : -1; }); element.focus({ preventScroll: true }); if (scroll) element.querySelector('.tree-row').scrollIntoView({ block: 'nearest' }); }
}
function toggle(key, desired) {
  const node = treeNodes.get(key); if (!node || node.cycle) return;
  const next = desired ?? !isOpen(key);
  if (state.filter) state.filterOverrides.set(key, next); else if (next) state.expanded.add(key); else state.expanded.delete(key);
  state.focusKey = key; renderTree(); focusTree(key);
  if (next && node.kind !== 'resource' && !state.pages.has(key)) loadGroup(node);
}
function renderExplorer() {
  $('#scope-caption').textContent = `${state.principal} · ${state.permission} permission`;
  $$('[data-permission]').forEach((button) => { button.classList.toggle('active', button.dataset.permission === state.permission); button.setAttribute('aria-pressed', button.dataset.permission === state.permission); });
  renderTree(); renderInspector();
}
async function selectResource(resource) {
  state.selected = resource; state.reversePermission = supports(resource.type, state.reversePermission) ? state.reversePermission : permissions(resource.type)[0].name;
  state.decisions = {}; state.reverse = null; const token = ++state.inspectorEpoch; const epoch = state.epoch;
  renderTree(); renderInspector();
  await Promise.allSettled(permissions(resource.type).map(async ({ name }) => {
    try { const result = await request('check-permission', { ...authInput(resource.type, resource.id, name), ...cacheInput() }, epoch); if (token === state.inspectorEpoch && epoch === state.epoch) state.decisions[name] = result; }
    catch (error) { if (token === state.inspectorEpoch && epoch === state.epoch) state.decisions[name] = { error: error.message }; }
    if (token === state.inspectorEpoch && epoch === state.epoch) renderInspector();
  }));
  if (token === state.inspectorEpoch && epoch === state.epoch) loadReverse();
}
async function loadReverse(direction = 'first') {
  if (!connected() || !state.selected || state.reverse?.loading) return;
  const resource = state.selected; const permission = state.reversePermission; const token = state.inspectorEpoch; const epoch = state.epoch;
  const old = state.reverse; const history = direction === 'next' ? [...old.history, old.cursor || null] : [...(old?.history || [])];
  const cursor = direction === 'next' ? old.pageInfo.endCursor : direction === 'previous' ? history.pop() : null;
  if (direction === 'first') history.length = 0;
  const page = { loading: true, items: [], history, cursor }; state.reverse = page; renderInspector();
  try {
    const result = await request('lookup-subjects', { resourceType: resource.type, resourceId: resource.id, subjectType: 'user', permission, pageSize: 5, ...(cursor ? { cursor } : {}), ...cacheInput() }, epoch);
    Object.assign(page, result.data, { meta: result.meta });
  } catch (error) { page.error = error.message; }
  if (token === state.inspectorEpoch && epoch === state.epoch && permission === state.reversePermission && state.reverse === page) { page.loading = false; renderInspector(); }
}
function renderInspector() {
  const resource = state.selected;
  if (!resource) { $('#access-pane').innerHTML = `<div class="inspector-empty"><span class="empty-icon">${icon('shield')}</span><p class="eyebrow">WHO CAN SEE WHAT?</p><h2 id="access-title" tabindex="-1">Select a resource</h2><p>See permission decisions and the principals who have access.</p><span class="operation-label">lookup-subjects</span></div>`; return; }
  const reverse = state.reverse;
  $('#access-pane').innerHTML = `<header class="pane-heading inspector-heading"><div><p class="eyebrow">RESOURCE ACCESS</p><h2 id="access-title" tabindex="-1">${escapeHtml(resource.id)}</h2><span class="type-tag">${resource.type}</span></div><span class="resource-symbol ${resource.type}">${icon(resource.type)}</span></header><div class="inspector-body"><h3>Permissions for <code>${escapeHtml(state.principal)}</code></h3><div class="decision-list">${permissions(resource.type).map(({ name }) => { const result = state.decisions[name]; return `<div class="decision"><div><strong>${name}</strong><span class="decision-value ${result?.data?.allowed ? 'allowed' : result?.data ? 'denied' : ''}">${result?.error ? 'Error' : result?.data ? result.data.allowed ? '✓ Allowed' : '− Denied' : 'Checking…'}</span></div>${result?.error ? `<span class="error">${escapeHtml(result.error)}</span>` : evidence(result?.meta, 'check')}<small class="operation-label">check-permission</small></div>`; }).join('')}</div><div class="reverse-heading"><h3>Who has access?</h3><span class="operation-label">lookup-subjects</span></div><div class="segmented reverse-permissions">${permissions(resource.type).map(({ name }) => `<button data-reverse-permission="${name}" class="${name === state.reversePermission ? 'active' : ''}" aria-pressed="${name === state.reversePermission}">Can ${name}</button>`).join('')}</div><div class="reverse-evidence">${reverse?.loading ? 'Looking up subjects…' : evidence(reverse?.meta, 'lookup')}</div>${reverse?.error ? `<p class="error">${escapeHtml(reverse.error)} <button class="text-button" data-reverse-page="first">Retry</button></p>` : `<ul class="holder-list">${(reverse?.items || []).map((subject) => `<li><span class="small-avatar">${subject.id === 'super-user' ? 'SU' : 'U'}</span><code>${escapeHtml(subject.id)}</code><button class="explore-as" data-explore-as="${escapeHtml(subject.id)}" aria-label="Explore as ${escapeHtml(subject.id)}" title="Explore as ${escapeHtml(subject.id)}">↗</button></li>`).join('')}</ul>`}${reverse && !reverse.loading ? `<div class="pagination reverse-pagination"><span>${reverse.items.length} on page ${reverse.history.length + 1}</span><button class="text-button" data-reverse-page="previous" ${reverse.history.length ? '' : 'disabled'}>Previous</button><button class="text-button" data-reverse-page="next" ${reverse.pageInfo?.hasNextPage ? '' : 'disabled'}>Next →</button></div>` : ''}<details class="object-details"><summary>Resource attributes</summary><pre>${escapeHtml(JSON.stringify(resource, null, 2))}</pre></details></div>`;
}
function renderSchema() {
  $('#schema-view').innerHTML = `<header class="schema-heading"><div><p class="eyebrow">CANONICAL STRESS-TEST SCHEMA</p><h2>Permission schema</h2><p>6 definitions · 13 relations · 9 permissions</p></div><span class="schema-digest">SHA-256 <code>${schema.sha256.slice(0, 16)}…</code></span></header><p>Recursive account and server parents, permission arrows, shared administration, and intentionally cyclic fixture relationships are preserved.</p><div class="schema-grid">${schema.types.map((type) => `<article class="schema-card"><h3>${icon(type.name)}${type.name}</h3><h4>Relations</h4>${type.relations.length ? type.relations.map((relation) => `<p><code>${relation.name}</code><span>→ ${relation.subjectTypes.join(' | ')}</span></p>`).join('') : '<p class="muted">No relations</p>'}<h4>Permissions</h4>${type.permissions.length ? type.permissions.map((permission) => `<div class="schema-expression"><strong>${permission.name}</strong><code>${escapeHtml(permission.expression)}</code></div>`).join('') : '<p class="muted">Subject type</p>'}</article>`).join('')}</div><details class="schema-source" open><summary>Exact source · fixtures/schema.v1.zed</summary><pre>${escapeHtml(metadata.schemaSource)}</pre></details>`;
}
function renderActivity() {
  $('#activity-view').innerHTML = `<header class="pane-heading"><div><h2>Query activity</h2><p>Latest 100 responses in the current scope · local runtime operation latency</p></div></header><div class="activity-table"><table><thead><tr><th>Operation / target</th><th>Latency</th><th>Cache outcome</th><th>Result</th><th>Request / basis</th></tr></thead><tbody>${state.activity.map((entry) => `<tr><td><strong>${entry.operation}</strong><small>${escapeHtml([entry.input.subjectId, entry.input.permission, entry.input.resourceType, entry.input.resourceId].filter(Boolean).join(' · '))}</small></td><td class="numeric">${ms(entry.meta?.elapsedMs)}</td><td>${cacheBadge(entry.meta)}</td><td>${entry.error ? escapeHtml(entry.error.message) : entry.data?.allowed !== undefined ? entry.data.allowed ? 'Allowed' : 'Denied' : entry.data?.value !== undefined ? `${entry.data.value}${entry.data.exact ? ' exact' : '+'}` : entry.data?.items ? `${entry.data.items.length} items` : 'OK'}</td><td><code>${escapeHtml(entry.meta?.requestId || '')}</code><small>${escapeHtml(entry.meta?.revision || '')}</small></td></tr>`).join('') || '<tr><td colspan="5">No queries in this scope.</td></tr>'}</tbody></table></div>`;
}
function showView(view) {
  if (!schema) { notify('The canonical runtime is still starting.'); return; }
  state.view = view; for (const name of ['explorer', 'schema', 'activity']) $(`#${name}-view`).hidden = name !== view;
  $$('[data-view]').forEach((button) => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  if (view === 'activity') renderActivity(); if (view === 'schema') renderSchema();
}
async function loadSubjects(direction = 'first') {
  if (!connected() || state.subjects.loading) return;
  const previous = state.subjects; const history = direction === 'next' ? [...previous.history, previous.cursor || null] : [...previous.history];
  const cursor = direction === 'next' ? previous.pageInfo.endCursor : direction === 'previous' ? history.pop() : null;
  if (direction === 'first') history.length = 0;
  const page = { items: [], history, cursor, loading: true }; state.subjects = page;
  const epoch = state.epoch; renderPrincipalPicker();
  try { const result = await request('list-subjects', { type: 'user', pageSize: 25, ...(cursor ? { cursor } : {}) }, epoch); Object.assign(page, result.data); }
  catch (error) { page.error = error.message; }
  page.loading = false; if ($('#detail-dialog').dataset.view === 'principal' && $('#detail-dialog').open) renderPrincipalPicker();
}
function renderPrincipalPicker() {
  const page = state.subjects;
  $('#dialog-body').innerHTML = `<p>Select a known user from the canonical fixture.</p><div class="quick-subjects">${quickSubjects.map((id) => `<button class="choice ${state.principal === id ? 'active' : ''}" data-principal="${id}">${id}</button>`).join('')}</div><label class="search-field"><span data-icon="search"></span><input type="search" id="principal-search" placeholder="Filter these 25 known users…" aria-label="Filter loaded principals"></label><div class="principal-list">${page.loading ? '<p>Loading known users…</p>' : page.error ? `<p class="error">${escapeHtml(page.error)} <button data-subject-page="first">Retry</button></p>` : page.items.map((subject) => `<button class="principal-option" data-principal="${escapeHtml(subject.id)}"><span class="small-avatar">U</span><code>${escapeHtml(subject.id)}</code>${state.principal === subject.id ? '<span>✓</span>' : ''}</button>`).join('')}</div><div class="pagination"><span>${page.items.length} of 80 known users · page ${page.history.length + 1}</span><button class="text-button" data-subject-page="first" ${page.history.length && !page.loading ? '' : 'disabled'}>First</button><button class="text-button" data-subject-page="previous" ${page.history.length && !page.loading ? '' : 'disabled'}>Previous</button><button class="text-button" data-subject-page="next" ${page.pageInfo?.hasNextPage && !page.loading ? '' : 'disabled'}>Next →</button></div>`;
  hydrateIcons();
}
async function openDialog(name, trigger) {
  if (!bootstrap) { notify('The canonical runtime is still starting.'); return; }
  const dialog = $('#detail-dialog'); if (!dialog.open) previousDialogFocus = trigger; dialog.dataset.view = name;
  const titles = { principal: 'Explore as a principal', consistency: 'Consistency semantics', cache: 'Cache & diagnostics', dataset: 'Canonical dataset', identity: 'Local runtime identity', about: 'About this design' };
  $('#dialog-title').textContent = titles[name]; $('#dialog-body').innerHTML = '';
  if (!dialog.open) dialog.showModal();
  if (name === 'principal') { renderPrincipalPicker(); if (!state.subjects.items.length) loadSubjects(); }
  if (name === 'consistency') $('#dialog-body').innerHTML = `<p>All four consistency choices remain visible in the main workspace. The active browser runtime advertises only <strong>minimize-latency</strong>; its immutable basis lasts for the page lifecycle.</p><p>Re-query reuses that basis and the current cache options. This runtime has no snapshot-refresh operation and cannot promise exact historical reads, an external freshness floor, or fully consistent authoritative reads.</p><p>The connected implementation must retain the existing relative/absolute freshness controls, exact datetime selection, at-or-before resolution, and independent snapshot refresh for profiles that support them.</p><pre>${escapeHtml(JSON.stringify({ basis: bootstrap.basis, consistencyModes: bootstrap.capabilities.consistencyModes, limitations: bootstrap.capabilities.limitations }, null, 2))}</pre>`;
  if (name === 'dataset') $('#dialog-body').innerHTML = `<p>The original <strong>10,000-resource</strong> browser fixture is loaded by the compiled EACL runtime. It contains 80 subjects and 38,613 relationships. Identifiers, schema, recursive parent chains, and intentional cycles are unchanged.</p><pre>${escapeHtml(JSON.stringify(metadata.manifest, null, 2))}</pre>`;
  if (name === 'identity') $('#dialog-body').innerHTML = `<p>Live queries run in the browser using the repository's compiled DataScript runtime. Other backend cards preview the catalog's existing options; this page makes no remote profile requests.</p><pre>${escapeHtml(JSON.stringify({ identity: metadata.identity, basis: bootstrap.basis, runtime: bootstrap.runtime, profile: bootstrap.profile }, null, 2))}</pre>`;
  if (name === 'about') $('#dialog-body').innerHTML = '<p>An isolated local design shell over the real EACL DataScript runtime and canonical stress-test fixture.</p><p>Latency comes directly from each response’s <code>elapsedMs</code>: operation dispatch time in this browser, not a network measurement or cross-backend benchmark. Cache outcomes come from <code>cacheStatus</code>; “not reported” means the operation supplies no cache outcome. Read and populate preferences are separate from measured hits and misses.</p><p>The production explorer and its other supported profiles, schema graph controls, local seeding, expiry/caveats playground, and snapshot tooling remain in the existing application. Their preservation is mandatory in the OpenSpec implementation tasks.</p>';
  if (name === 'cache') {
    $('#dialog-body').innerHTML = '<p>Reading cache diagnostics…</p>';
    try {
      const result = await request('get-cache-info');
      if (dialog.open && dialog.dataset.view === name) $('#dialog-body').innerHTML = `<p>Actual page-local EACL provider statistics and operation metrics. Changing Read cache and Populate cache preserves existing cache entries. Re-query can therefore demonstrate reuse.</p><button class="quiet-button" data-dialog="cache">Refresh diagnostics</button><pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`;
    } catch (error) { if (dialog.dataset.view === name) $('#dialog-body').textContent = error.message; }
  }
}
async function requery() {
  if (!connected()) return;
  const groups = visibleTreeItems().map((item) => treeNodes.get(item.dataset.key)).filter((node) => node.kind !== 'resource' && isOpen(node.key));
  await Promise.allSettled(groups.map((node) => loadGroup(node)));
  if (state.selected) await selectResource(state.selected);
  notify('Re-queried the same browser basis with the current cache settings.');
}
async function runCheck(event) {
  event.preventDefault(); const token = ++state.checkEpoch; const epoch = state.epoch;
  const resourceType = $('#check-type').value, resourceId = $('#check-resource').value.trim(), principal = $('#check-principal').value.trim(), permission = $('#check-permission').value;
  $('#check-result').textContent = 'Checking…';
  try {
    // Validate typed identifiers against the actual fixture; do not turn a missing object into a denial.
    await request('get-object', { type: 'user', id: principal }, epoch);
    await request('get-object', { type: resourceType, id: resourceId }, epoch);
    const response = await request('check-permission', { ...authInput(resourceType, resourceId, permission, principal), ...cacheInput() }, epoch);
    if (token === state.checkEpoch && epoch === state.epoch) $('#check-result').innerHTML = `<strong class="${response.data.allowed ? 'allowed' : 'denied'}">${response.data.allowed ? '✓ Allowed' : '− Denied'}</strong>${evidence(response.meta, 'check-permission')}`;
  } catch (error) { if (token === state.checkEpoch && epoch === state.epoch) $('#check-result').innerHTML = `<span class="error">${escapeHtml(error.message)}</span>${error.meta ? evidence(error.meta) : ''}`; }
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  const data = button.dataset;
  if (data.dialog) openDialog(data.dialog, button);
  if (data.view) showView(data.view);
  if (data.backend) { state.backend = data.backend; state.storage = metadata.catalog.backends.find((entry) => entry.id === data.backend).storages[0]; state.execution = metadata.platforms[`${state.backend}/${state.storage}`][0].id; renderEnvironment(); resetScope(); }
  if (data.storage) { state.storage = data.storage; state.execution = metadata.platforms[`${state.backend}/${state.storage}`][0].id; renderEnvironment(); resetScope(); }
  if (data.execution) { state.execution = data.execution; renderEnvironment(); resetScope(); }
  if (data.permission && data.permission !== state.permission) { state.permission = data.permission; resetScope(); }
  if (data.toggle) toggle(data.toggle);
  if (data.select) { const node = treeNodes.get(data.select); state.focusKey = node.key; selectResource(node.resource); }
  if (data.page) loadGroup(treeNodes.get(data.group), data.page);
  if (data.retry) loadGroup(treeNodes.get(data.retry));
  if (data.principal || data.exploreAs) { $('#detail-dialog').close(); setPrincipal(data.principal || data.exploreAs); }
  if (data.subjectPage) loadSubjects(data.subjectPage);
  if (data.reversePermission && data.reversePermission !== state.reversePermission) { state.reversePermission = data.reversePermission; state.reverse = null; loadReverse(); }
  if (data.reversePage) loadReverse(data.reversePage);
});
$('#theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); });
$('#principal-trigger').addEventListener('click', (event) => openDialog('principal', event.currentTarget));
$('#close-dialog').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => { if (previousDialogFocus?.isConnected) previousDialogFocus.focus(); });
document.addEventListener('input', (event) => { if (event.target.id === 'principal-search') { const query = event.target.value.toLowerCase(); $$('.principal-option').forEach((element) => { element.hidden = !element.dataset.principal.toLowerCase().includes(query); }); } });
$('#resource-filter').addEventListener('input', (event) => { state.filter = event.target.value; state.filterOverrides.clear(); renderTree(); });
$('#page-size').addEventListener('change', resetScope);
$('#cache-read').addEventListener('change', (event) => { state.cache = event.target.checked; resetScope(); });
$('#cache-populate').addEventListener('change', (event) => { state.populateCache = event.target.checked; resetScope(); });
$('#density-toggle').addEventListener('click', () => { state.compact = !state.compact; savePreferences(); $('#density-toggle').setAttribute('aria-label', `Use ${state.compact ? 'comfortable' : 'compact'} rows`); renderTree(); });
$('#collapse-all').addEventListener('click', () => { state.expanded.clear(); state.filterOverrides.clear(); state.filter = ''; $('#resource-filter').value = ''; state.focusKey = 'root:account'; renderTree(); });
$('#requery').addEventListener('click', requery);
$('#view-access').addEventListener('click', () => { $('#access-title').focus(); $('#access-pane').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#check-form').addEventListener('submit', runCheck);
$('#check-form').addEventListener('input', () => { state.checkEpoch++; $('#check-result').textContent = 'Ready to check · inputs changed.'; });
$('#check-type').addEventListener('change', () => { $('#check-permission').innerHTML = permissions($('#check-type').value).map(({ name }) => `<option>${name}</option>`).join(''); });
$('#resource-tree').addEventListener('keydown', (event) => {
  const visible = visibleTreeItems(); const index = visible.findIndex((item) => item === document.activeElement); if (index < 0) return;
  const node = treeNodes.get(visible[index].dataset.key); let next;
  if (event.key === 'ArrowDown') next = visible[Math.min(index + 1, visible.length - 1)]?.dataset.key;
  if (event.key === 'ArrowUp') next = visible[Math.max(index - 1, 0)]?.dataset.key;
  if (event.key === 'Home') next = visible[0]?.dataset.key;
  if (event.key === 'End') next = visible.at(-1)?.dataset.key;
  if (event.key === 'ArrowRight') { if (visible[index].getAttribute('aria-expanded') === 'false') toggle(node.key, true); else if (visible[index].getAttribute('aria-expanded') === 'true') next = visible[index + 1]?.dataset.key; }
  if (event.key === 'ArrowLeft') { if (visible[index].getAttribute('aria-expanded') === 'true') toggle(node.key, false); else next = node.parent; }
  if (event.key === 'Enter' || event.key === ' ') { if (node.kind === 'resource') selectResource(node.resource); else toggle(node.key); }
  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
  if (next) focusTree(next);
});
document.addEventListener('keydown', (event) => { if (event.key === '/' && !$('#detail-dialog').open && !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); $('#resource-filter').focus(); } });
async function initialize() {
  applyTheme(); hydrateIcons();
  try {
    const response = await fetch('/preview-metadata.json'); if (!response.ok) throw new Error('Preview metadata unavailable.'); metadata = await response.json();
    await window.EaclDataScriptRuntime.initialize(metadata.identity, owner);
    const result = await window.EaclDataScriptRuntime.request('bootstrap', {}, crypto.randomUUID(), owner);
    if (result.error) throw new Error(result.error.message); bootstrap = result.data;
    state.ready = true;
    const schemaResult = await request('get-schema'); schema = schemaResult.data;
    if (schema.sha256 !== metadata.schema.sha256 || bootstrap.dataset.manifestSha256 !== metadata.identity.dataManifestSha256) throw new Error('Canonical schema or fixture identity mismatch.');
    $('#dataset-stats').innerHTML = `<div><strong>${metadata.manifest.counts.objects.resources.total.toLocaleString()}</strong><span>resources</span></div><div><strong>${metadata.manifest.counts.relationships.total.toLocaleString()}</strong><span>relationships</span></div><div><strong>${metadata.manifest.counts.objects.subjects.total}</strong><span>principals</span></div><button class="text-button" data-dialog="dataset">Canonical browser fixture ↗</button>`;
    $('#check-type').innerHTML = resourceTypes().map((type) => `<option ${type === 'server' ? 'selected' : ''}>${type}</option>`).join('');
    renderEnvironment(); renderSchema(); renderExplorer();
    await loadGroup({ kind: 'root', key: 'root:account', type: 'account' });
    const resource = state.pages.get('root:account')?.items.find((item) => item.id === 'account-0'); if (resource) selectResource(resource);
  } catch (error) { state.ready = false; $('#runtime-status').textContent = 'Runtime unavailable'; $('#resource-tree').innerHTML = `<div class="empty-tree error"><strong>Could not initialize the canonical runtime</strong><p>${escapeHtml(error.message)}</p></div>`; }
}
initialize();
