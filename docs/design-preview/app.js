// Design shell over the unmodified canonical EACL DataScript runtime.
import { selectBackend as transitionBackend } from '/selection.mjs';
import { normalizePlatform } from '/platforms.mjs';
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
  principal: 'user-1', subjectType: 'user', pickerType: 'user', seeding: false, permission: 'view', selected: null, reversePermission: 'view',
  backend: 'datascript', storage: 'browser-memory', execution: 'browser', ready: false,
  epoch: 0, inspectorEpoch: 0, checkEpoch: 0, expanded: new Set(['root:account', 'root:server']), pages: new Map(),
  focusKey: 'root:account', compact: preferences.compact === true, view: 'explorer',
  cache: true, populateCache: true,
  decisions: {}, reverse: null, subjects: { items: [], cursor: null, history: [], index: 0 },
  theme: ['light', 'dark'].includes(requestedTheme) ? requestedTheme : preferences.theme === 'dark' ? 'dark' : 'light',
};
const knownObjects = new Map();
let checkTimer;
let metadata, bootstrap, schema, treeNodes = new Map(), previousDialogFocus, toastTimer;
const connected = () => state.ready && state.backend === 'datascript';
const permissions = (type) => schema?.types.find((entry) => entry.name === type)?.permissions || [];
const supports = (type, permission) => permissions(type).some((entry) => entry.name === permission);
const pageSize = () => Number($('#page-size').value);
const cacheInput = () => ({ cache: state.cache, populateCache: state.populateCache, consistency: 'minimize' });
const authInput = (type, id, permission = state.permission, principal = state.principal) => ({
  subjectType: state.subjectType, subjectId: principal, resourceType: type, ...(id ? { resourceId: id } : {}), permission,
});
const ms = (value) => typeof value === 'number' && Number.isFinite(value) ? `${value < 0.01 ? '<0.01' : value.toFixed(2)}ms` : '—';
function evidence(meta, label = '') {
  if (!meta) return '';
  return `<span class="operation-evidence cache-badge ${escapeHtml(meta.cacheStatus || '')}" title="${escapeHtml(`${label}\nRequest: ${meta.requestId}\nBasis: ${meta.revision}`)}"><b>${ms(meta.elapsedMs)}</b>${meta.cacheStatus ? `<span>${escapeHtml(meta.cacheStatus.toUpperCase())}</span>` : ''}</span>`;
}
function remember(items = []) {
  let changed = false;
  for (const object of items) if (object?.type && object?.id && !knownObjects.has(`${object.type}:${object.id}`)) {
    knownObjects.set(`${object.type}:${object.id}`, object); changed = true;
    if (knownObjects.size > 2500) knownObjects.delete(knownObjects.keys().next().value);
  }
  if (changed) renderSuggestions();
}
function renderSuggestions() {
  for (const [list, type] of [['subject-ids', $('#check-subject-type').value], ['resource-ids', $('#check-type').value]]) {
    $(`#${list}`).innerHTML = [...knownObjects.values()].filter((item) => item.type === type).map((item) => `<option value="${escapeHtml(item.id)}"></option>`).join('');
  }
}
function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  $('#announcement').textContent = message; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
async function request(operation, input = {}, epoch = state.epoch) {
  if (!connected()) throw new Error('This profile is not connected in the local design preview.');
  const response = await window.EaclDataScriptRuntime.request(operation, input, crypto.randomUUID(), owner);
  if (response.error) { const error = new Error(response.error.message); error.meta = response.meta; throw error; }
  remember(response.data?.items || (response.data?.object ? [response.data.object] : []));
  return response;
}
let viewportAnchor, viewportFrame;
function releaseViewport() {
  cancelAnimationFrame(viewportFrame); viewportAnchor = undefined;
}
for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, releaseViewport, { passive: true, capture: true });
function preserveViewport(update) {
  const anchor = viewportAnchor || { x: window.scrollX, y: window.scrollY };
  viewportAnchor = anchor;
  // Preserve space through a shorter loading/result view, including fractional zoom coordinates.
  document.body.style.minHeight = `${Math.ceil(Math.max(innerHeight, anchor.y + innerHeight + 2))}px`;
  const restore = () => window.scrollTo({ left: anchor.x, top: anchor.y, behavior: 'instant' });
  try { return update(); }
  finally {
    restore(); cancelAnimationFrame(viewportFrame);
    // Native focus and layout settle after the event handler has returned.
    viewportFrame = requestAnimationFrame(() => {
      if (viewportAnchor !== anchor) return;
      restore();
      viewportFrame = requestAnimationFrame(() => { if (viewportAnchor === anchor) { restore(); viewportAnchor = undefined; } });
    });
  }
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
  return preserveViewport(() => {
  const { catalog } = metadata;
  const storageLabel = (entry) => ({ ...entry, label: entry.id === 'browser-memory' ? 'Browser In-memory' : entry.label });
  const choice = (kind, entry, selected) => `<label class="profile-option" title="${escapeHtml(entry.reason || entry.label)}"><input type="radio" name="explorer-${kind}" value="${entry.id}" ${selected === entry.id ? 'checked' : ''} ${entry.selectable === false ? 'disabled' : ''}><span class="option-label"><span>${escapeHtml(entry.label)}</span>${entry.selectable === false ? '<small class="option-status">Not deployed for this backend</small>' : ''}</span></label>`;
  $('#backend-options').innerHTML = catalog.backends.filter((entry) => entry.id !== 'jank').map((entry) => choice('backend', entry, state.backend)).join('');
  const backend = catalog.backends.find((entry) => entry.id === state.backend);
  $('#storage-options').innerHTML = backend.storages.map((id) => choice('storage', storageLabel(catalog.storages.find((entry) => entry.id === id)), state.storage)).join('');
  const activeExecution = metadata.platforms[`${state.backend}/${state.storage}`];
  $('#execution-options').innerHTML = activeExecution.map((entry) => choice('execution', entry, state.execution)).join('');
  $('#execution-sizing').innerHTML = metadata.platforms['datomic/dynamodb'].map((entry) => `<span class="profile-option"><span class="radio-size"></span><span class="option-label"><span>${escapeHtml(entry.label)}</span><small class="option-status">Not deployed for this backend</small></span></span>`).join('');
  $('#profile-collapsed').textContent = `${backend.label} · ${storageLabel(catalog.storages.find((entry) => entry.id === state.storage)).label} · ${activeExecution.find((entry) => entry.id === state.execution).label}`;
  $('#runtime-status').hidden = connected();
  $('#runtime-status').textContent = state.backend === 'datascript' ? 'Starting EACL…' : 'Profile not connected in this preview.';
  const modes = ['minimize-latency', 'at-least-as-fresh', 'at-exact-snapshot', 'fully-consistent'];
  const reasons = ['', 'Requires freshness synchronization', 'Requires full history', 'Requires authoritative synchronization'];
  $('#consistency-options').innerHTML = modes.map((mode, index) => {
    const reason = index === 3 && state.backend === 'datahike' ? `Disabled to avoid ${state.storage === 's3' ? 'S3 GETs' : 'DynamoDB reads'} in demo` : !connected() ? 'Profile not connected' : state.seeding ? 'Adding resources' : reasons[index];
    return `<label class="consistency-radio" title="${reason || 'Use the current browser basis'}"><input type="radio" name="consistency-semantics" value="${mode}" ${index === 0 && connected() ? 'checked' : ''} ${index > 0 || !connected() || state.seeding ? 'disabled' : ''}><span class="option-label"><span>${mode}</span>${reason ? `<small class="option-status">${reason}</small>` : ''}</span></label>`;
  }).join('');
  $('#basis-summary').innerHTML = connected() ? `<span>Basis</span><code title="${escapeHtml(bootstrap.basis.id)}">${escapeHtml(bootstrap.basis.id.split(':').at(-1))}</code>` : '';
  $('#requery').disabled = !connected() || state.seeding;
  $('#check-form button[type=submit]').disabled = !connected() || state.seeding;
  $('#principal-trigger').disabled = !connected() || state.seeding;
  $('#page-size').disabled = !connected() || state.seeding;
  $('#seed-form').hidden = !connected();
  $('#dataset-stats').hidden = !connected();
  $('#seed-form button').disabled = state.seeding;
  $('#seed-amount').disabled = state.seeding;
  $('#query-workspace').inert = state.seeding && connected();
  $('#check-form').inert = state.seeding;
  });
}
function resetScope({ preserveSelection = false } = {}) {
  const selected = preserveSelection ? state.selected : null;
  state.epoch++; state.inspectorEpoch++; state.checkEpoch++; state.pages.clear(); state.selected = selected;
  state.expanded = new Set([...state.expanded].filter((key) => !key.includes('/')));
  state.decisions = {}; state.reverse = null;
  $('#check-result').textContent = '';
  renderExplorer();
  scheduleCheck();
  for (const type of resourceTypes()) if (isOpen(`root:${type}`)) loadGroup({ kind: 'root', key: `root:${type}`, type });
  if (selected) selectResource(selected);
}
function setPrincipal(id, type = 'user') {
  return preserveViewport(() => {
  state.principal = id; state.subjectType = type;
  $('#principal-name').textContent = type === 'user' ? id : `${type}:${id}`;
  $('.principal-trigger .avatar').textContent = type === 'user' ? id === 'super-user' ? 'SU' : 'U' : type[0].toUpperCase();
  resetScope(); notify(`View As ${type}:${id}`);
  });
}
function resourceTypes() { return schema?.types.filter((type) => type.permissions.length).map((type) => type.name) || []; }
function relationships(resource) {
  return schema.types.flatMap((type) => type.relations.filter((relation) => relation.subjectTypes.includes(resource.type)).map((relation) => ({ type: type.name, relation: relation.name })));
}
const isOpen = (key) => state.expanded.has(key);
function resourceNode(resource, parent, ancestors, decision) {
  const identity = `${resource.type}:${resource.id}`;
  return { key: `${parent}/object:${identity}`, kind: 'resource', type: resource.type, label: resource.id, resource, decision, ancestors: [...ancestors, identity], cycle: ancestors.includes(identity) };
}
function children(node) {
  if (node.kind === 'resource') return node.cycle ? [] : relationships(node.resource).map((group) => ({
    key: `${node.key}/relation:${group.type}:${group.relation}`, kind: 'relation', label: typeNames[group.type], ...group, resource: node.resource, ancestors: node.ancestors,
  }));
  return (state.pages.get(node.key)?.items || []).map((resource) => resourceNode(resource, node.key, node.ancestors || [], state.pages.get(node.key)?.checks?.find((check) => check.id === resource.id)));
}
async function loadGroup(node, direction = 'first') {
  if (!connected() || state.seeding || (node.kind !== 'root' && node.kind !== 'relation')) return;
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
          const count = await request('count-resources', { ...query, ceiling: previous?.count?.ceiling || 1000 }, epoch);
          if (epoch !== state.epoch) return;
          page.count = count.data; page.countMeta = count.meta; page.countError = null;
        } catch (error) { page.countError = error.message; }
      }
    } else {
      const response = await request('reverse-relationships', { subjectType: node.resource.type, subjectId: node.resource.id, relation: node.relation, pageSize: pageSize(), ...(cursor ? { cursor } : {}), ...cacheInput() }, epoch);
      if (epoch !== state.epoch) return;
      page.meta = response.meta; page.pageInfo = response.data.pageInfo; page.linkedCount = response.data.items.length;
      page.checks = [];
      for (const resource of response.data.items.filter((item) => item.type === node.type)) {
        const decision = await request('check-permission', { ...authInput(resource.type, resource.id), ...cacheInput() }, epoch);
        if (epoch !== state.epoch) return;
        page.checks.push({ id: resource.id, meta: decision.meta, allowed: decision.data.allowed });
        if (decision.data.allowed) page.items.push(resource);
      }
    }
  } catch (error) { if (epoch === state.epoch) { page.error = error.message; page.meta = error.meta; } }
  if (epoch === state.epoch) { page.loading = false; renderTree(); }
}
async function increaseCount(key) {
  const node = treeNodes.get(key), page = state.pages.get(key), epoch = state.epoch;
  if (!node || !page?.count || page.count.exact || page.countLoading || !connected()) return;
  const ceiling = Math.min(30000, page.count.ceiling * 2);
  page.countLoading = true; renderTree();
  try {
    const response = await request('count-resources', { ...authInput(node.type), ...cacheInput(), ceiling }, epoch);
    if (epoch !== state.epoch || state.pages.get(key) !== page) return;
    page.count = response.data; page.countMeta = response.meta; page.countError = null;
  } catch (error) { if (epoch === state.epoch) page.countError = error.message; }
  if (epoch === state.epoch && state.pages.get(key) === page) { page.countLoading = false; renderTree(); }
}
function disclosure(open) { return `<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="3"/><path d="M5 9h8${open ? '' : 'M9 5v8'}"/></svg>`; }
function nodeHtml(node, level = 1, parent = null) {
  const page = state.pages.get(node.key);
  treeNodes.set(node.key, { ...node, parent, level });
  const expandable = !node.cycle && (node.kind !== 'resource' || relationships(node.resource).length > 0);
  const open = expandable && isOpen(node.key);
  const selected = node.kind === 'resource' && state.selected?.type === node.type && state.selected?.id === node.resource.id;
  const key = escapeHtml(node.key), label = escapeHtml(node.label || typeNames[node.type]);
  const permissionSupported = supports(node.type, state.permission);
  let query = '';
  if (node.kind === 'resource' && node.decision) query = evidence(node.decision.meta, `${state.permission} permission check`);
  else if (!permissionSupported) query = '<span class="muted">Permission not defined</span>';
  else if (page) {
    const start = page.items.length ? page.history.length * pageSize() + 1 : 0;
    const end = page.history.length * pageSize() + page.items.length;
    if (node.kind === 'root') {
      const total = Math.max(page.count?.value || 0, end);
      const lowerBound = page.count ? !page.count.exact || end > page.count.value : page.pageInfo?.hasNextPage;
      const count = `${total.toLocaleString()}${lowerBound ? '+' : ''}`;
      const countHtml = page.count && !page.count.exact && page.count.ceiling < 30000
        ? `<button class="count-value count-action" data-increase-count="${key}" title="Count up to ${Math.min(30000, page.count.ceiling * 2).toLocaleString()}" ${page.countLoading ? 'disabled' : ''}>${count}</button>`
        : `<strong class="count-value">${page.count ? count : '…'}</strong>`;
      query = `<span class="page-measure" title="Returned resource range"><strong>${start.toLocaleString()}–${(page.items.length ? end : 0).toLocaleString()}</strong>${evidence(page.meta, 'Resource page')}</span><span class="count-measure">of ${countHtml}${evidence(page.countMeta, 'Resource count')}${page.countLoading ? '<span>Counting…</span>' : ''}</span>`;
    } else {
      // The runtime supplies a bounded linked-object page, then checks each object's permission.
      // Do not present that traversal's input size as an authorized total or include checks in its timing.
      query = `<span class="page-measure" title="Authorized objects shown from this linked-object page; total not queried"><strong>${page.items.length} shown</strong>${evidence(page.meta, 'Linked-object page only; each shown object has a separate permission-check badge')}</span>`;
    }
    if (page.loading) query += '<span class="muted">Loading…</span>';
    if (page.countError) query += `<span class="error">Count failed: ${escapeHtml(page.countError)}</span>`;
    if (open && !page.loading) query += `<span class="branch-pagination" role="group" aria-label="${label}${node.relation ? ` via ${node.relation}` : ''} Pagination"><button data-page="first" data-group="${key}" ${page.history.length ? '' : 'disabled'} aria-label="First page of ${label}">First</button><button data-page="previous" data-group="${key}" ${page.history.length ? '' : 'disabled'}>Prev</button><button data-page="next" data-group="${key}" ${page.pageInfo?.hasNextPage ? '' : 'disabled'}>Next</button></span>`;
  }
  return `<li role="treeitem" class="tree-item" data-key="${key}" aria-level="${level}" ${expandable ? `aria-expanded="${open}"` : ''} ${node.kind === 'resource' ? `aria-selected="${selected}"` : ''} aria-label="${label}${node.cycle ? ', cycle boundary' : ''}" tabindex="${node.key === state.focusKey ? 0 : -1}">
    <div class="tree-row ${node.kind}-row ${selected ? 'selected' : ''}" style="--level:${level}"><div class="tree-identity"><button class="disclosure" tabindex="-1" data-toggle="${key}" aria-label="${open ? 'Collapse' : 'Expand'} ${label}" ${expandable ? '' : 'disabled'}>${disclosure(open)}</button><div class="row-content"><div class="row-line"><button class="row-label" tabindex="-1" ${node.kind === 'resource' ? `data-select="${key}"` : `data-toggle="${key}"`}><span class="resource-symbol ${node.type}">${node.kind === 'relation' ? '↳' : icon(node.type)}</span><strong>${label}</strong>${node.kind === 'relation' ? `<small>via :${node.relation}</small>` : ''}</button>${node.cycle ? '<span class="cycle-label">cycle ↩</span>' : ''}${query}</div></div></div></div>
    ${open ? `<ul role="group">${!permissionSupported ? '<li role="none" class="tree-hint">This type does not define this permission.</li>' : page?.error ? `<li role="none" class="tree-hint error">${escapeHtml(page.error)} <button data-retry="${key}">Retry</button></li>` : `${children(node).map((child) => nodeHtml(child, level + 1, node.key)).join('')}${node.kind !== 'resource' && page && !page.loading && !page.items.length ? '<li role="none" class="tree-hint">No authorized results in this page.</li>' : ''}`}</ul>` : ''}
  </li>`;
}
function renderTree() {
  return preserveViewport(() => {
  const container = $('#resource-tree'); const top = container.scrollTop;
  const focused = container.contains(document.activeElement) ? document.activeElement.closest('[data-key]')?.dataset.key : null;
  treeNodes = new Map();
  container.innerHTML = !connected() ? '<div class="empty-tree"><strong>Profile Not Connected</strong><p>Select DataScript to explore the original fixture with live local EACL queries.</p></div>' : `<ul role="group">${resourceTypes().map((type) => nodeHtml({ kind: 'root', type, key: `root:${type}`, label: typeNames[type] })).join('')}</ul>`;
  container.classList.toggle('compact', state.compact); container.scrollTop = top;
  const visible = visibleTreeItems();
  if (!visible.some((item) => item.dataset.key === state.focusKey)) state.focusKey = visible[0]?.dataset.key;
  visible.forEach((item) => { item.tabIndex = item.dataset.key === state.focusKey ? 0 : -1; });
  container.tabIndex = visible.length ? -1 : 0;
  if (focused) focusTree(visible.some((item) => item.dataset.key === focused) ? focused : state.focusKey, false);
  });
}
function visibleTreeItems() { return $$('[role=treeitem]', $('#resource-tree')); }
function focusTree(key, scroll = true) {
  const element = visibleTreeItems().find((item) => item.dataset.key === key);
  if (element) { state.focusKey = key; visibleTreeItems().forEach((item) => { item.tabIndex = item === element ? 0 : -1; }); element.focus({ preventScroll: true }); if (scroll) element.querySelector('.tree-row').scrollIntoView({ block: 'nearest' }); }
}
function toggle(key, desired) {
  const node = treeNodes.get(key); if (!node || node.cycle) return;
  const next = desired ?? !isOpen(key);
  if (next) state.expanded.add(key); else state.expanded.delete(key);
  state.focusKey = key; renderTree(); focusTree(key, false);
  if (next && node.kind !== 'resource' && !state.pages.has(key)) loadGroup(node);
}
function renderExplorer() {
  $$('input[name="resource-permission"]').forEach((input) => { input.checked = input.value === state.permission; });
  renderTree(); renderInspector();
}
async function selectResource(resource) {
  if (!connected() || state.seeding) return;
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
  return preserveViewport(() => {
  const resource = state.selected;
  if (!resource) { $('#access-pane').innerHTML = `<div class="inspector-empty"><h2 id="access-title" tabindex="-1">Select a Resource</h2><p>Inspect its permissions and who has access.</p></div>`; return; }
  const reverse = state.reverse;
  const decisionRows = permissions(resource.type).map(({ name }) => {
    const result = state.decisions[name];
    return `<div class="decision"><strong>${name}</strong><span class="decision-value ${result?.data?.allowed ? 'allowed' : result?.data ? 'denied' : ''}">${result?.error ? 'Error' : result?.data ? result.data.allowed ? '✓ Allowed' : '− Denied' : 'Checking…'}</span>${result?.error ? `<span class="error">${escapeHtml(result.error)}</span>` : evidence(result?.meta)}</div>`;
  }).join('');
  $('#access-pane').innerHTML = `<header class="pane-heading inspector-heading"><div><h2 id="access-title" tabindex="-1">${escapeHtml(resource.id)}</h2><span class="type-tag">${resource.type}</span></div><span class="resource-symbol ${resource.type}">${icon(resource.type)}</span></header><div class="inspector-body"><h3>Permissions</h3><div class="decision-list">${decisionRows}</div><div class="reverse-heading"><h3>Who Has Access?</h3></div><fieldset class="permission-options reverse-permissions" aria-label="Subject lookup permission">${permissions(resource.type).map(({ name }) => `<label><input type="radio" name="reverse-permission" value="${name}" ${name === state.reversePermission ? 'checked' : ''}> ${name}</label>`).join('')}</fieldset><div class="reverse-pagination-controls branch-pagination" role="group" aria-label="Who Has Access Pagination"><button data-reverse-page="previous" ${reverse && !reverse.loading && reverse.history.length ? '' : 'disabled'}>Prev</button><button data-reverse-page="next" ${reverse && !reverse.loading && reverse.pageInfo?.hasNextPage ? '' : 'disabled'}>Next</button></div><div class="reverse-evidence query-result">${reverse && !reverse.loading && !reverse.error ? `<strong>${reverse.items.length ? reverse.history.length * 5 + 1 : 0}–${reverse.items.length ? reverse.history.length * 5 + reverse.items.length : 0}${reverse.pageInfo?.hasNextPage ? '' : ` of ${reverse.history.length * 5 + reverse.items.length}`}</strong>` : ''}${reverse?.loading ? '<span>Querying…</span>' : evidence(reverse?.meta)}</div>${reverse?.error ? `<p class="error">${escapeHtml(reverse.error)} <button data-reverse-page="first">Retry</button></p>` : `<ul class="holder-list">${(reverse?.items || []).map((subject) => `<li><span class="small-avatar">${subject.id === 'super-user' ? 'SU' : 'U'}</span><code>${escapeHtml(subject.id)}</code><button class="explore-as" data-explore-as="${escapeHtml(subject.id)}" data-subject-type="${escapeHtml(subject.type)}" aria-label="View As ${escapeHtml(subject.id)}" title="View As ${escapeHtml(subject.id)}">↗</button></li>`).join('')}</ul>`}<details class="object-details"><summary>Resource Attributes</summary><pre>${escapeHtml(JSON.stringify(resource, null, 2))}</pre></details></div>`;
  });
}
function renderSchema() {
  return preserveViewport(() => {
  $('#schema-view').innerHTML = `<header class="schema-heading"><div><p class="eyebrow">CANONICAL STRESS-TEST SCHEMA</p><h2>Permission Schema</h2><p>6 definitions · 13 relations · 9 permissions</p></div><span class="schema-digest">SHA-256 <code>${schema.sha256.slice(0, 16)}…</code></span></header><p>Recursive account and server parents, permission arrows, shared administration, and intentionally cyclic fixture relationships are preserved.</p><details class="schema-source" open><summary>Exact source · fixtures/schema.v1.zed</summary><pre>${escapeHtml(metadata.schemaSource)}</pre></details><div class="schema-grid">${schema.types.map((type) => `<article class="schema-card"><h3>${icon(type.name)}${type.name[0].toUpperCase() + type.name.slice(1)}</h3><h4>Relations</h4>${type.relations.length ? type.relations.map((relation) => `<p><code>${relation.name}</code><span>→ ${relation.subjectTypes.join(' | ')}</span></p>`).join('') : '<p class="muted">No relations</p>'}<h4>Permissions</h4>${type.permissions.length ? type.permissions.map((permission) => `<div class="schema-expression"><strong>${permission.name}</strong><code>${escapeHtml(permission.expression)}</code></div>`).join('') : '<p class="muted">Subject type</p>'}</article>`).join('')}</div>`;
  });
}
function showView(view) {
  return preserveViewport(() => {
  if (!schema) { notify('The canonical runtime is still starting.'); return; }
  state.view = view; for (const name of ['explorer', 'schema']) $(`#${name}-view`).hidden = name !== view;
  $$('[data-view]').forEach((button) => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  if (view === 'schema') renderSchema();
  });
}
async function loadSubjects(direction = 'first') {
  if (!connected() || state.subjects.loading) return;
  const previous = state.subjects, type = state.pickerType, epoch = state.epoch;
  const history = direction === 'next' ? [...previous.history, previous.cursor || null] : [...previous.history];
  const cursor = direction === 'next' ? previous.pageInfo.endCursor : direction === 'previous' ? history.pop() : null;
  if (direction === 'first') history.length = 0;
  const page = { items: [], history, cursor, loading: true }; state.subjects = page; renderPrincipalPicker();
  try {
    // list-subjects enumerates the fixture's user-role records only. Resource types use
    // the existing bounded lookup under the canonical super-user, not an invented list/search API.
    const result = type === 'user'
      ? await request('list-subjects', { type, pageSize: 25, ...(cursor ? { cursor } : {}) }, epoch)
      : await request('lookup-resources', { subjectType: 'user', subjectId: 'super-user', resourceType: type, permission: 'view', pageSize: 25, ...(cursor ? { cursor } : {}), ...cacheInput() }, epoch);
    Object.assign(page, result.data, { meta: result.meta });
  } catch (error) { page.error = error.message; }
  page.loading = false;
  if (epoch === state.epoch && state.subjects === page && $('#detail-dialog').dataset.view === 'principal' && $('#detail-dialog').open) renderPrincipalPicker();
}
function renderPrincipalPicker() {
  const restoreTypeFocus = document.activeElement?.id === 'picker-type';
  const page = state.subjects, start = page.items.length ? page.history.length * 25 + 1 : 0, end = page.history.length * 25 + page.items.length;
  $('#dialog-body').innerHTML = `<label class="picker-type">Subject Type <select id="picker-type">${schema.types.map(({ name }) => `<option ${name === state.pickerType ? 'selected' : ''}>${name}</option>`).join('')}</select></label><div class="quick-subjects">${state.pickerType === 'user' ? quickSubjects.map((id) => `<button class="choice ${state.subjectType === 'user' && state.principal === id ? 'active' : ''}" data-principal="${id}" data-subject-type="user">${id}</button>`).join('') : ''}</div><div class="principal-list">${page.loading ? '<p>Loading…</p>' : page.error ? `<p class="error">${escapeHtml(page.error)} <button data-subject-page="first">Retry</button></p>` : page.items.length ? page.items.map((subject) => `<button class="principal-option" data-principal="${escapeHtml(subject.id)}" data-subject-type="${subject.type}"><span class="small-avatar">${subject.type[0].toUpperCase()}</span><code>${escapeHtml(subject.id)}</code>${state.subjectType === subject.type && state.principal === subject.id ? '<span>✓</span>' : ''}</button>`).join('') : '<p>No objects in this page.</p>'}</div><div class="pagination"><span>${start}–${page.items.length ? end : 0}${state.pickerType === 'user' ? ' of 80' : ''} ${evidence(page.meta, state.pickerType === 'user' ? 'Known users' : 'Objects visible to the canonical super-user')}</span><button data-subject-page="first" ${page.history.length && !page.loading ? '' : 'disabled'}>First</button><button data-subject-page="previous" ${page.history.length && !page.loading ? '' : 'disabled'}>Prev</button><button data-subject-page="next" ${page.pageInfo?.hasNextPage && !page.loading ? '' : 'disabled'}>Next</button></div>`;
  if (restoreTypeFocus) $('#picker-type').focus({ preventScroll: true });
}
async function openDialog(name, trigger) {
  if (!bootstrap) { notify('The canonical runtime is still starting.'); return; }
  const dialog = $('#detail-dialog'); if (!dialog.open) previousDialogFocus = trigger; dialog.dataset.view = name;
  const titles = { principal: 'View As', cache: 'Cache Diagnostics' };
  $('#dialog-title').textContent = titles[name]; $('#dialog-body').innerHTML = '';
  if (!dialog.open) dialog.showModal();
  if (name === 'principal') { if (state.pickerType !== state.subjectType) { state.pickerType = state.subjectType; state.subjects = { items: [], history: [] }; } renderPrincipalPicker(); if (!state.subjects.items.length) loadSubjects(); }
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
function canCheck() {
  return connected() && !state.seeding && ['check-subject-type', 'check-principal', 'check-type', 'check-resource', 'check-permission'].every((id) => $(`#${id}`).value.trim());
}
function scheduleCheck() {
  clearTimeout(checkTimer); state.checkEpoch++;
  $('#check-result').textContent = '';
  $('#check-form button[type=submit]').disabled = !canCheck();
  if (canCheck()) checkTimer = setTimeout(() => runCheck(), 175);
}
async function runCheck(event) {
  event?.preventDefault(); clearTimeout(checkTimer);
  const token = ++state.checkEpoch, epoch = state.epoch;
  const subjectType = $('#check-subject-type').value, resourceType = $('#check-type').value;
  const resourceId = $('#check-resource').value.trim(), principal = $('#check-principal').value.trim(), permission = $('#check-permission').value;
  if (!connected() || state.seeding || !subjectType || !resourceType || !resourceId || !principal || !permission) return;
  const input = { ...authInput(resourceType, resourceId, permission, principal), subjectType, ...cacheInput() };
  $('#check-result').textContent = 'Checking…';
  $('#check-form button[type=submit]').disabled = true;
  try {
    await request('get-object', { type: subjectType, id: principal }, epoch);
    if (token !== state.checkEpoch || epoch !== state.epoch) return;
    await request('get-object', { type: resourceType, id: resourceId }, epoch);
    if (token !== state.checkEpoch || epoch !== state.epoch) return;
    const response = await request('check-permission', input, epoch);
    if (token === state.checkEpoch && epoch === state.epoch) $('#check-result').innerHTML = `<span class="query-result"><strong class="${response.data.allowed ? 'allowed' : 'denied'}">${response.data.allowed ? '✓ Allowed' : '− Denied'}</strong>${evidence(response.meta)}</span>`;
  } catch (error) { if (token === state.checkEpoch && epoch === state.epoch) $('#check-result').innerHTML = `<span class="error">${escapeHtml(error.message)}</span>${error.meta ? evidence(error.meta) : ''}`; }
  finally { if (token === state.checkEpoch) $('#check-form button[type=submit]').disabled = !canCheck(); }
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) {
    const row = event.target.closest('.resource-row');
    const node = row && treeNodes.get(row.closest('[data-key]').dataset.key);
    if (node && !event.target.closest('a, input, select, textarea')) {
      state.focusKey = node.key;
      selectResource(node.resource);
    }
    return;
  }
  if (button.disabled) return;
  const data = button.dataset;
  if (data.dialog) openDialog(data.dialog, button);
  if (data.view) showView(data.view);
  if (data.toggle) toggle(data.toggle);
  if (data.select) { const node = treeNodes.get(data.select); state.focusKey = node.key; selectResource(node.resource); }
  if (data.page) loadGroup(treeNodes.get(data.group), data.page);
  if (data.retry) loadGroup(treeNodes.get(data.retry));
  if (data.increaseCount) increaseCount(data.increaseCount);
  if (data.principal || data.exploreAs) { $('#detail-dialog').close(); setPrincipal(data.principal || data.exploreAs, data.subjectType); }
  if (data.subjectPage) loadSubjects(data.subjectPage);
  if (data.reversePage) loadReverse(data.reversePage);
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'picker-type') { state.pickerType = event.target.value; state.subjects = { items: [], history: [] }; loadSubjects(); return; }
  if (event.target.name === 'resource-permission') { state.permission = event.target.value; resetScope({ preserveSelection: true }); return; }
  if (event.target.name === 'reverse-permission') { state.reversePermission = event.target.value; state.reverse = null; loadReverse(); $$('.reverse-permissions input').find((input) => input.value === state.reversePermission)?.focus({ preventScroll: true }); return; }
  const input = event.target.closest('.profile-option input');
  if (!input || input.disabled) return;
  const kind = input.name.replace('explorer-', '');
  if (kind === 'backend') {
    const next = transitionBackend(metadata.catalog, state, input.value);
    state.backend = next.backend; state.storage = next.storage;
    state.execution = normalizePlatform(next, state.execution);
  } else if (kind === 'storage') {
    state.storage = input.value;
    state.execution = normalizePlatform(state, state.execution);
  } else if (kind === 'execution') state.execution = input.value;
  else return;
  renderEnvironment(); resetScope();
  $$('.profile-option input').find((candidate) => candidate.name === input.name && candidate.value === input.value)?.focus({ preventScroll: true });
});
$('#theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); });
$('#principal-trigger').addEventListener('click', (event) => openDialog('principal', event.currentTarget));
$('#close-dialog').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => { if (previousDialogFocus?.isConnected) previousDialogFocus.focus({ preventScroll: true }); });
$('#page-size').addEventListener('change', resetScope);
$('#cache-read').addEventListener('change', (event) => { state.cache = event.target.checked; resetScope({ preserveSelection: true }); });
$('#cache-populate').addEventListener('change', (event) => { state.populateCache = event.target.checked; resetScope({ preserveSelection: true }); });
$('#collapse-all').addEventListener('click', () => { state.expanded.clear(); state.focusKey = 'root:account'; renderTree(); });
$('#requery').addEventListener('click', requery);
$('#view-access').addEventListener('click', () => { $('#access-title').focus(); $('#access-pane').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#check-form').addEventListener('submit', runCheck);
$('#check-form').addEventListener('input', scheduleCheck);
$('#check-form').addEventListener('change', scheduleCheck);
$('#check-subject-type').addEventListener('change', renderSuggestions);
$('#check-type').addEventListener('change', () => { renderSuggestions(); const prior = $('#check-permission').value; $('#check-permission').innerHTML = permissions($('#check-type').value).map(({ name }) => `<option ${name === prior ? 'selected' : ''}>${name}</option>`).join(''); });
$('#resource-tree').addEventListener('keydown', (event) => {
  if (event.target !== document.activeElement || event.target.getAttribute('role') !== 'treeitem') return;
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
function toggleSection(button, content, collapsed) {
  return preserveViewport(() => {
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open)); content.hidden = !open;
  if (collapsed) { collapsed.hidden = open; button.textContent = open ? '−' : '+'; button.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} Backend, Storage and Execution`); }
  else button.querySelector('span').textContent = open ? '−' : '+';
  });
}
$('#environment-toggle').addEventListener('click', (event) => toggleSection(event.currentTarget, $('#profile-rows'), $('#profile-collapsed')));
$('#consistency-toggle').addEventListener('click', (event) => toggleSection(event.currentTarget, $('#consistency-options')));
$('#checker-toggle').addEventListener('click', (event) => toggleSection(event.currentTarget, $('#check-form')));
new ResizeObserver(() => document.documentElement.style.setProperty('--checker-height', `${$('.query-lab').getBoundingClientRect().height + 24}px`)).observe($('.query-lab'));
async function refreshTotals(query = request) {
  const [objects, relationships] = await Promise.all(['objects', 'relationships'].map((kind) => query('count-objects', { kind, ceiling: 1000000 })));
  $('#dataset-stats').innerHTML = `<div><strong>${objects.data.value.toLocaleString()}</strong><span>objects</span></div><div><strong>${relationships.data.value.toLocaleString()}</strong><span>relationships</span></div>`;
}
async function seedResources(retry = false) {
  const amount = Number($('#seed-amount').value);
  if (!retry && (!Number.isSafeInteger(amount) || amount < 1)) {
    $('#seed-status').textContent = 'Enter a positive whole number.'; return;
  }
  const seedRequest = async (operation, input = {}) => {
    const result = await window.EaclDataScriptRuntime.request(operation, input, crypto.randomUUID(), owner);
    if (result.error) throw new Error(result.error.message);
    return result;
  };
  state.seeding = true; state.epoch++; state.inspectorEpoch++; state.checkEpoch++;
  state.pages.clear(); state.selected = null; state.subjects = { items: [], history: [] }; knownObjects.clear(); renderSuggestions();
  $('#check-result').textContent = ''; $('#seed-retry').hidden = true; renderEnvironment();
  $('#seed-progress').hidden = false; $('#seed-bar').value = 0;
  const update = (progress) => preserveViewport(() => { $('#seed-progress strong').textContent = progress.status === 'seeding' ? 'Seeding DataScript' : progress.status === 'error' ? 'DataScript Seed Failed' : 'DataScript Seed Complete'; $('#seed-status').textContent = `${progress.resourcesCompleted.toLocaleString()} / ${progress.resourcesTarget.toLocaleString()} added`; $('#seed-bar').value = 100 * progress.resourcesCompleted / Math.max(1, progress.resourcesTarget); });
  try {
    let result = await seedRequest(retry ? 'seed-retry' : 'seed-start', retry ? {} : { resourceCount: amount });
    update(result.data);
    while (result.data.status === 'seeding') {
      await new Promise((resolve) => setTimeout(resolve, 150));
      result = await seedRequest('seed-status'); update(result.data);
    }
    if (result.data.status === 'error') throw new Error(result.data.error);
    $('#seed-status').textContent += ' · Local changes reset on reload';
  } catch (error) {
    $('#seed-status').textContent = error.message;
    try { const progress = await seedRequest('seed-status'); $('#seed-retry').hidden = progress.data.status !== 'error'; } catch { /* Keep the original error visible. */ }
  } finally {
    try { bootstrap = (await seedRequest('bootstrap')).data; await refreshTotals(seedRequest); } catch (error) { $('#seed-status').textContent = error.message; }
    state.seeding = false; renderEnvironment(); resetScope();
  }
}
$('#seed-form').addEventListener('submit', (event) => { event.preventDefault(); if (!state.seeding && connected()) seedResources(); });
$('#seed-retry').addEventListener('click', () => { if (!state.seeding && connected()) seedResources(true); });
async function initialize() {
  applyTheme(); hydrateIcons();
  if (matchMedia('(max-width: 650px)').matches) toggleSection($('#checker-toggle'), $('#check-form'));
  try {
    const response = await fetch('/preview-metadata.json'); if (!response.ok) throw new Error('Preview metadata unavailable.'); metadata = await response.json();
    await window.EaclDataScriptRuntime.initialize(metadata.identity, owner);
    const result = await window.EaclDataScriptRuntime.request('bootstrap', {}, crypto.randomUUID(), owner);
    if (result.error) throw new Error(result.error.message); bootstrap = result.data;
    state.ready = true;
    const schemaResult = await request('get-schema'); schema = schemaResult.data;
    if (schema.sha256 !== metadata.schema.sha256 || bootstrap.dataset.manifestSha256 !== metadata.identity.dataManifestSha256) throw new Error('Canonical schema or fixture identity mismatch.');
    await refreshTotals();
    $('#check-subject-type').innerHTML = schema.types.map(({ name }) => `<option ${name === 'user' ? 'selected' : ''}>${name}</option>`).join('');
    remember(quickSubjects.map((id) => ({ type: 'user', id })));
    $('#check-type').innerHTML = resourceTypes().map((type) => `<option ${type === 'server' ? 'selected' : ''}>${type}</option>`).join('');
    renderEnvironment(); renderSchema(); renderExplorer(); scheduleCheck();
    await Promise.all(['account', 'server'].map((type) => loadGroup({ kind: 'root', key: `root:${type}`, type })));
    const resource = state.pages.get('root:account')?.items.find((item) => item.id === 'account-0'); if (resource) selectResource(resource);
  } catch (error) { state.ready = false; $('#runtime-status').hidden = false; $('#runtime-status').textContent = 'Runtime unavailable'; $('#resource-tree').innerHTML = `<div class="empty-tree error"><strong>Could not initialize the canonical runtime</strong><p>${escapeHtml(error.message)}</p></div>`; }
}
initialize();
