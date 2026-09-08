// Isolated interaction prototype. This fixture is not an EACL engine or benchmark.
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
const principals = [
  { id: 'user-1', name: 'User 1', initials: 'U1', detail: 'Production account owner', tone: '' },
  { id: 'user-2', name: 'User 2', initials: 'U2', detail: 'Staging account owner', tone: 'amber' },
  { id: 'super-user', name: 'Super User', initials: 'SU', detail: 'Platform-wide administrator', tone: 'teal' },
  { id: 'team-lead', name: 'Team Lead', initials: 'TL', detail: 'View through a team relationship', tone: '' },
  { id: 'visitor', name: 'Visitor', initials: 'V', detail: 'No grants in this sample', tone: '' },
];
const types = ['account', 'team', 'vpc', 'server', 'platform'];
const typeNames = { account: 'Accounts', team: 'Teams', vpc: 'VPCs', server: 'Servers', platform: 'Platforms' };
const resources = [{ id: 'platform-0', name: 'Platform', type: 'platform', account: null }];
const serverNames = ['payments-api', 'checkout-api', 'identity-service', 'event-worker', 'reporting-api', 'web-gateway', 'audit-worker', 'notification-api'];
for (let account = 0; account < 3; account++) {
  resources.push({ id: `account-${account}`, name: ['Production', 'Staging', 'Development'][account], type: 'account', account });
  for (let index = 0; index < 2; index++) {
    resources.push({ id: `account-${account}-team-${index}`, name: ['Engineering', 'Operations'][index], type: 'team', account, index });
    resources.push({ id: `account-${account}-vpc-${index}`, name: ['Private network', 'Public network'][index], type: 'vpc', account, index });
  }
  serverNames.forEach((name, index) => resources.push({ id: `account-${account}-server-${index}`, name, type: 'server', account, index }));
}
const resourceById = (id) => resources.find((resource) => resource.id === id);
const principalById = (id) => principals.find((principal) => principal.id === id);
function sampleAllowed(principal, permission, resource) {
  if (!resource || (resource.type === 'platform' && permission !== 'view')) return false;
  if (principal === 'super-user') return true;
  if (resource.type === 'platform' || principal === 'visitor') return false;
  if (principal === 'user-1') return resource.account === 0;
  if (principal === 'user-2') return resource.account === 1;
  return principal === 'team-lead' && resource.account === 0 &&
    ((resource.type === 'team' && resource.index === 0) ||
      (permission === 'view' && resource.type === 'server' && resource.index % 2 === 0));
}

const preferenceKey = 'eacl-resource-design.preview.v1';
const requestedTheme = new URLSearchParams(location.search).get('theme');
let saved = {};
try { saved = JSON.parse(localStorage.getItem(preferenceKey)) || {}; } catch { /* Optional preview preferences. */ }
const state = {
  principal: 'user-1', permission: 'view', selected: 'account-0', reversePermission: 'view',
  expanded: new Set(Array.isArray(saved.expanded) ? saved.expanded.filter((key) => typeof key === 'string').slice(0, 100) : ['root:account', 'root:account/account-0']),
  theme: ['light', 'dark'].includes(requestedTheme) ? requestedTheme : saved.theme === 'dark' ? 'dark' : 'light',
  compact: saved.compact === true, filter: '', filterOverrides: new Map(), pages: new Map(),
  consistency: 'minimize-latency', freshnessMode: 'relative', secondsAgo: 0, at: '', exactAt: '',
  snapshot: 1, cache: true, populateCache: true, view: 'explorer', activity: [], focusKey: 'root:account',
};
let treeNodes = new Map();
let toastTimeout;
let previousDialogFocus;
function savePreferences() {
  try { localStorage.setItem(preferenceKey, JSON.stringify({ expanded: [...state.expanded].slice(0, 100), theme: state.theme, compact: state.compact })); } catch { /* Optional. */ }
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4200);
  $('#announcement').textContent = message;
}
function log(operation, target, count) {
  state.activity.unshift({ operation, target, count, basis: state.snapshot });
  state.activity = state.activity.slice(0, 30);
  $('#activity-count').textContent = state.activity.length;
  $('#query-summary').textContent = `${operation} · sample result`;
  if (state.view === 'activity') renderActivity();
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('#theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`);
  savePreferences();
}
function setPrincipal(id) {
  if (!principalById(id)) return;
  state.principal = id;
  state.selected = null;
  state.pages.clear();
  state.focusKey = 'root:account';
  const principal = principalById(id);
  $('#principal-name').textContent = principal.name;
  $('.principal-trigger .avatar').textContent = principal.initials;
  $('.principal-trigger .avatar').className = `avatar ${principal.tone}`;
  renderExplorer();
  log('lookup-resources', `${id} · ${state.permission}`, accessible().length);
  $('#announcement').textContent = `Exploring as ${principal.name}. ${accessible().length} sample resources. Select a resource to inspect access.`;
}
const accessible = () => resources.filter((resource) => sampleAllowed(state.principal, state.permission, resource));
const isOpen = (key) => state.filter ? (state.filterOverrides.get(key) ?? true) : state.expanded.has(key);
function toggle(key, desired) {
  const next = desired ?? !isOpen(key);
  if (state.filter) state.filterOverrides.set(key, next);
  else if (next) state.expanded.add(key); else state.expanded.delete(key);
  state.focusKey = key;
  savePreferences();
  const node = treeNodes.get(key);
  if (next && node) log(node.kind === 'root' ? 'lookup-resources' : 'list-relationships', node.label, node.count);
  renderTree();
  focusTree(key);
}
function relationships(resource) {
  if (resource.type === 'account') return [
    { type: 'team', relation: 'account' }, { type: 'vpc', relation: 'account' }, { type: 'server', relation: 'account' },
  ];
  if (resource.type === 'team' || resource.type === 'vpc') return [{ type: 'server', relation: resource.type }];
  return [];
}
function relationChildren(resource, group) {
  return accessible().filter((child) => child.type === group.type && child.account === resource.account &&
    (resource.type === 'account' || child.index % 2 === resource.index));
}
function resourceNode(resource, path) {
  const key = `${path}/${resource.id}`;
  return { key, kind: 'resource', type: resource.type, label: resource.name, resource, children: relationships(resource).map((group) => {
    const groupKey = `${key}/relation:${group.type}:${group.relation}`;
    const children = relationChildren(resource, group).map((child) => resourceNode(child, groupKey));
    return { key: groupKey, kind: 'relation', type: group.type, label: typeNames[group.type], relation: group.relation, count: children.length, children };
  }) };
}
function roots() {
  const allowed = accessible();
  return types.map((type) => ({ key: `root:${type}`, kind: 'root', type, label: typeNames[type], count: allowed.filter((resource) => resource.type === type).length,
    children: allowed.filter((resource) => resource.type === type).map((resource) => resourceNode(resource, `root:${type}`)) }));
}
function filteredNode(node, ancestorMatch = false) {
  const query = state.filter.toLowerCase().trim();
  if (!query) return node;
  const match = ancestorMatch || `${node.label} ${node.resource?.id || ''}`.toLowerCase().includes(query);
  const children = node.children.map((child) => filteredNode(child, match)).filter(Boolean);
  return match || children.length ? { ...node, children } : null;
}
function disclosure(open, expandable) {
  return `<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="3"/><path d="M5 9h8${open ? '' : 'M9 5v8'}" stroke-width="1.5"/></svg>`;
}
function nodeHtml(node, level = 1, parent = null) {
  treeNodes.set(node.key, { ...node, parent, level });
  const expandable = node.kind !== 'resource' || node.children.length > 0;
  const open = expandable && isOpen(node.key);
  const selected = node.kind === 'resource' && node.resource.id === state.selected;
  const key = escapeHtml(node.key);
  const pageSize = Number($('#page-size').value);
  const limit = (state.pages.get(node.key) || 1) * pageSize;
  const visibleChildren = node.children.slice(0, state.filter ? undefined : limit);
  return `<li role="treeitem" class="tree-item" data-key="${key}" aria-level="${level}" ${expandable ? `aria-expanded="${open}"` : ''} ${node.kind === 'resource' ? `aria-selected="${selected}"` : ''} aria-label="${escapeHtml(`${node.label}${node.resource ? `, ${node.resource.id}` : `, ${node.count} sample results`}`)}" tabindex="${node.key === state.focusKey ? '0' : '-1'}">
    <div class="tree-row ${node.kind}-row">
      <button tabindex="-1" class="disclosure ${expandable ? '' : 'empty'}" data-toggle="${key}" aria-label="${open ? 'Collapse' : 'Expand'} ${escapeHtml(node.label)}" ${expandable ? '' : 'disabled'}>${disclosure(open, expandable)}</button>
      ${node.kind !== 'relation' ? `<span class="resource-symbol ${node.type}">${icon(node.type)}</span>` : '<span class="relation-tag" aria-hidden="true">↳</span>'}
      <button tabindex="-1" class="row-label" ${node.resource ? `data-select="${escapeHtml(node.resource.id)}"` : `data-toggle="${key}"`}><strong>${escapeHtml(node.label)}</strong>${node.resource ? `<code>${escapeHtml(node.resource.id)}</code>` : ''}${node.kind === 'relation' ? `<span class="relation-tag">via :${node.relation}</span>` : ''}</button>
      ${node.count !== undefined ? `<span class="count-pill" title="${node.count} ${node.kind === 'root' ? 'accessible resources of this type' : 'authorized children for this relationship'} in the illustrative dataset">${node.count}</span>` : selected ? '<span class="row-check" aria-hidden="true">✓</span>' : ''}
    </div>
    ${open ? `<ul role="group">${visibleChildren.map((child) => nodeHtml(child, level + 1, node.key)).join('')}${!node.children.length ? '<li role="none" class="tree-hint">No accessible results for this permission.</li>' : ''}${!state.filter && node.children.length > limit ? `<li role="none"><button class="quiet-button load-page" data-more="${key}">Show next ${Math.min(pageSize, node.children.length - limit)} <span class="muted">${limit} of ${node.children.length} loaded</span></button></li>` : ''}</ul>` : ''}
  </li>`;
}
function renderTree() {
  const scrollTop = $('#resource-tree').scrollTop;
  treeNodes = new Map();
  const nodes = roots().map((node) => filteredNode(node)).filter(Boolean);
  $('#resource-tree').innerHTML = nodes.length ? `<ul role="group">${nodes.map((node) => nodeHtml(node)).join('')}</ul>` : `<div class="empty-tree">${icon('search')}<strong>No loaded resources match</strong>Try an identifier or clear the filter.<br><button class="text-button" id="clear-filter">Clear filter</button></div>`;
  $('#resource-tree').scrollTop = scrollTop;
  $('#resource-tree').classList.toggle('compact', state.compact);
  $('#resource-tree').tabIndex = nodes.length ? -1 : 0;
  // Restore a visible roving focus target if an ancestor was collapsed or filtered away.
  if (!treeNodes.has(state.focusKey)) state.focusKey = nodes[0]?.key || '';
  $$('[role=treeitem]', $('#resource-tree')).forEach((element) => { element.tabIndex = element.dataset.key === state.focusKey ? 0 : -1; });
}
function focusTree(key) {
  const element = $$('[role=treeitem]', $('#resource-tree')).find((row) => row.dataset.key === key);
  if (element) {
    $$('[role=treeitem]', $('#resource-tree')).forEach((row) => { row.tabIndex = row === element ? 0 : -1; });
    state.focusKey = key;
    element.focus({ preventScroll: true });
    element.querySelector('.tree-row').scrollIntoView({ block: 'nearest' });
  }
}
function selectResource(id, key) {
  state.selected = id;
  state.focusKey = key || state.focusKey;
  renderExplorer();
  log('lookup-subjects', id, principals.filter((principal) => sampleAllowed(principal.id, state.reversePermission, resourceById(id))).length);
  if (key) focusTree(key);
  $('#announcement').textContent = `${resourceById(id).name} selected. Access inspector updated.`;
}
function renderInspector() {
  const resource = resourceById(state.selected);
  if (!resource) {
    $('#access-pane').innerHTML = `<div class="access-head"><p class="eyebrow">ACCESS INSPECTOR</p><h2 id="access-title">Who has access?</h2></div><div class="selection-empty">${icon('shield')}<h2>Select a resource</h2><p>Explore a resource type on the left, then select a resource to see its permission decisions and subjects.</p></div><div class="access-note">Principal selection filters the resource tree. This inspector answers the reverse question: who can access one resource?</div>`;
    return;
  }
  const principal = principalById(state.principal);
  const permissions = resource.type === 'platform' ? ['view'] : ['view', 'admin'];
  if (!permissions.includes(state.reversePermission)) state.reversePermission = permissions[0];
  const holders = principals.filter((person) => sampleAllowed(person.id, state.reversePermission, resource));
  $('#access-pane').innerHTML = `<header class="access-head"><p class="eyebrow">ACCESS INSPECTOR <span style="float:right">${icon('shield')}</span></p><div class="selected-resource"><span class="resource-symbol ${resource.type}">${icon(resource.type)}</span><div><h2 id="access-title">${escapeHtml(resource.name)}</h2><code>${resource.type}:${escapeHtml(resource.id)}</code></div></div><p class="resource-breadcrumb">${resource.type === 'account' ? 'Resource root / Accounts' : `Resource root / ${typeNames[resource.type]}`}<br>Selected in this exploration</p></header>
  <section class="access-section"><div class="section-heading"><h3>Can ${escapeHtml(principal.name)} access this?</h3><span>Sample</span></div><div class="decisions">${permissions.map((permission) => `<div class="decision"><span>${permission}</span><b class="${sampleAllowed(state.principal, permission, resource) ? 'allowed' : 'denied'}">${sampleAllowed(state.principal, permission, resource) ? '✓ Allowed' : '− Denied'}</b></div>`).join('')}</div></section>
  <section class="access-section"><div class="section-heading"><h3>Who has access?</h3><span class="operation-label">lookup-subjects</span></div><div class="segmented">${permissions.map((permission) => `<button data-reverse="${permission}" class="${state.reversePermission === permission ? 'active' : ''}" aria-pressed="${state.reversePermission === permission}">${permission === 'view' ? 'Can view' : 'Can administer'}</button>`).join('')}</div>
  ${holders.length ? holders.map((person) => `<div class="holder"><span class="avatar small ${person.tone}">${person.initials}</span><div class="holder-copy"><strong>${escapeHtml(person.name)}</strong><small>user:${person.id}</small></div>${person.id === state.principal ? '<span class="you-label">ACTIVE</span>' : `<button class="icon-button" data-as="${person.id}" title="Explore as ${escapeHtml(person.name)}" aria-label="Explore as ${escapeHtml(person.name)}">${icon('arrow')}</button>`}</div>`).join('') : '<p class="holder-empty">No subjects have this permission in the sample.</p>'}
  </section><div class="access-note">${holders.length} subjects in this illustrative result. Permission checks and reverse lookups retain their own query evidence in the connected design.</div><footer class="access-footer"><span>Sample snapshot ${String(state.snapshot).padStart(2, '0')}</span><button class="text-button" data-dialog="resource">Inspect resource ↗</button></footer>`;
}
function renderExplorer() {
  $('#view-access').disabled = !state.selected;
  $('#scope-caption').textContent = `${principalById(state.principal).name} · ${accessible().length} sample resources with ${state.permission} permission`;
  $$('[data-permission]').forEach((button) => { button.classList.toggle('active', button.dataset.permission === state.permission); button.setAttribute('aria-pressed', button.dataset.permission === state.permission); });
  renderTree(); renderInspector();
}
function updateBasis() {
  $('#basis-summary').innerHTML = `Sample snapshot <b>${String(state.snapshot).padStart(2, '0')}</b>`;
  $('#evidence-basis').textContent = `Sample ${String(state.snapshot).padStart(2, '0')}`;
  renderInspector();
}
function renderActivity() {
  $('#activity-view').innerHTML = `<h2 id="activity-title">Query activity</h2><p>These entries describe interactions with the local sample. A connected explorer records response timing, cache metadata, request identity, and the served basis here.</p>${state.activity.length ? `<table class="activity-table"><thead><tr><th>OPERATION</th><th>QUERY CONTEXT</th><th>RESULT</th><th>LATENCY</th></tr></thead><tbody>${state.activity.map((entry) => `<tr><td><code>${entry.operation}</code></td><td>${escapeHtml(entry.target)}</td><td>${escapeHtml(entry.count)} · sample ${entry.basis}</td><td>Unmeasured</td></tr>`).join('')}</tbody></table>` : '<div class="empty-tree"><strong>No interactions yet</strong>Expand a branch or run a permission check to see the activity design.</div>'}`;
}
function renderSchema() {
  $('#schema-view').innerHTML = `<h2 id="schema-title">The relationships behind access</h2><p>The diagram summarizes the hierarchy used in this sample. The permission expressions below are excerpts from the repository’s canonical fixture schema; the interaction prototype is not evaluating that schema.</p><div class="schema-map"><div class="schema-card"><h3>User</h3><p>owner<br>leader<br>shared_admin</p></div><span class="schema-arrow">→</span><div class="schema-card"><h3>Account</h3><p>owner: user<br>parent: account<br>platform: platform</p></div><span class="schema-arrow">→</span><div class="schema-card"><h3>Team / VPC</h3><p>account: account<br>leader: user<br>shared_admin: user</p></div><span class="schema-arrow">→</span><div class="schema-card"><h3>Server</h3><p>account / team / vpc<br>parent: server<br>shared_admin: user</p></div></div><pre>definition server {
  relation account: account
  relation team: team
  relation vpc: vpc
  relation shared_admin: user
  relation parent: server
  permission admin = account-&gt;admin + shared_admin
  permission view = admin + parent-&gt;view + account-&gt;view
                    + team-&gt;view + vpc-&gt;view + shared_admin
}</pre><p>The full schema graph, relation expressions, graph visibility preferences, and any descriptor-supported editing remain available in the connected implementation.</p>`;
}
function showView(view) {
  state.view = view;
  for (const name of ['explorer', 'schema', 'activity']) $(`#${name}-view`).hidden = name !== view;
  $$('[data-view]').forEach((button) => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  if (view === 'schema') renderSchema();
  if (view === 'activity') renderActivity();
}

function consistencyBody() {
  const descriptions = {
    'minimize-latency': 'Use a basis permitted by the active descriptor, favoring low latency. The served basis and cache metadata remain visible with each response.',
    'at-least-as-fresh': 'Require a basis at least as fresh as the selected floor. Relative “now” means the selected snapshot date, not the wall clock.',
    'at-exact-snapshot': 'Pin the request to an exact supported basis. Date selection is available only when the active descriptor supports resolving a retained snapshot.',
  };
  return `<p>Consistency stays visible while you explore. This panel is a control-layout demonstration; no snapshot or consistency operation is executed.</p><div class="dialog-note"><strong>${escapeHtml(state.consistency)}</strong><br>${descriptions[state.consistency]}</div>
    ${state.consistency === 'at-least-as-fresh' ? `<label class="dialog-control"><span>Freshness floor</span><select id="freshness-mode"><option value="relative" ${state.freshnessMode === 'relative' ? 'selected' : ''}>Seconds ago</option><option value="absolute" ${state.freshnessMode === 'absolute' ? 'selected' : ''}>Absolute datetime</option></select></label>${state.freshnessMode === 'relative' ? `<label class="dialog-control"><span>Seconds before selected snapshot</span><input id="freshness-seconds" type="number" min="0" step="1" value="${state.secondsAgo}"></label>` : `<label class="dialog-control"><span>Absolute datetime</span><input id="freshness-date" type="datetime-local" step="1" value="${escapeHtml(state.at)}"></label>`}<p class="dialog-note">Refresh Snapshot moves the relative floor and resets the absolute floor to the latest selected snapshot date in the connected explorer.</p>` : ''}
    ${state.consistency === 'at-exact-snapshot' ? `<label class="dialog-control"><span>Snapshot datetime<small>Sample of the supported-date layout</small></span><input id="exact-date" type="datetime-local" step="1" value="${escapeHtml(state.exactAt)}"></label><p class="dialog-note">A supporting profile resolves the latest available immutable snapshot at or before this datetime. Other profiles display their limitation instead of an editable date.</p>` : ''}
    <dl class="definition-list"><dt>Re-query</dt><dd>Run queries again within the selected consistency context. It does not imply that the source advanced.</dd><dt>Refresh Snapshot</dt><dd>Ask the active profile for its supported refreshed basis. A fixed snapshot may remain unchanged.</dd><dt>Fully consistent</dt><dd>Disabled in this sample capability layout. The connected control uses the deployed descriptor’s availability and exact limitation text; a read-only source must not imply a new writer barrier.</dd></dl>`;
}
const dialogBodies = {
  principal: () => `<p>Change the principal driving resource discovery.</p><label class="search-field">${icon('search')}<input id="principal-filter" type="search" placeholder="Find a sample principal…" aria-label="Find a sample principal"></label><div class="principal-options">${principals.map((principal) => `<button class="principal-option" data-principal="${principal.id}" aria-pressed="${state.principal === principal.id}"><span class="avatar ${principal.tone}">${principal.initials}</span><span><strong>${principal.name}</strong><small>${principal.detail} · ${principal.id}</small></span>${state.principal === principal.id ? '<span class="allowed">✓</span>' : ''}</button>`).join('')}</div><p class="dialog-note">5 illustrative principals. The connected picker retains quick subjects and the existing 25-user pagination.</p>`,
  consistency: consistencyBody,
  cache: () => `<p>Cache controls belong to the active query context. These switches change preview preferences only.</p><label class="dialog-control"><span>Read from cache<small>Preserves the existing cache-enabled control</small></span><input id="cache-enabled" type="checkbox" ${state.cache ? 'checked' : ''}></label><label class="dialog-control"><span>Populate cache<small>Independent of reading from cache</small></span><input id="populate-cache" type="checkbox" ${state.populateCache ? 'checked' : ''}></label><dl class="definition-list"><dt>Cache metrics</dt><dd>Not captured. The connected panel retains refresh, captured-at time, counters, and raw diagnostic output.</dd><dt>Eviction</dt><dd>Available only when the active descriptor advertises cache eviction. Public read-only profiles do not gain mutation controls.</dd></dl>`,
  dataset: () => `<p>A small, deliberately illustrative dataset lets you assess the design without starting a database.</p><dl class="definition-list">${types.map((type) => `<dt>${typeNames[type]}</dt><dd>${resources.filter((resource) => resource.type === type).length} sample resources</dd>`).join('')}</dl><div class="dialog-note">${resources.length} unique resources. A resource can appear both under a type root and under a relationship; appearances are not added together as a dataset total.</div><p>The connected DataScript demo retains Add resources, validation, seeding progress, retry, session reset messaging, and its advertised resource limit.</p>`,
  evidence: () => `<p>Performance is persuasive when visitors can inspect what was measured.</p><dl class="definition-list"><dt>Query latency</dt><dd>Show the elapsed timing supplied by the response, associated with that operation. Separately labelled browser round-trip timing must not be presented as engine execution time.</dd><dt>Cache result</dt><dd>Show actual response cache metadata. A preference set to “on” is not evidence of a cache hit.</dd><dt>Count completeness</dt><dd>Preserve bounded counts: 1,000+ means a lower bound, with the existing increase-count action. Page ranges and count timings remain separate.</dd><dt>Source and basis</dt><dd>Keep profile, runtime, dataset manifest, selected and served basis, deployment identity, and source commits available with the evidence.</dd><dt>Comparisons</dt><dd>Do not rank backends across unequal datasets. Storage speed labels continue to require the existing comparable, current benchmark evidence.</dd></dl><div class="dialog-note">This preview has no measured EACL timings. The em dash is intentional.</div>`,
  resource: () => `<p>Inspect the selected resource without losing the tree.</p><pre>${escapeHtml(JSON.stringify(resourceById(state.selected) || { message: 'Select a resource first.' }, null, 2))}</pre><p>These are illustrative display attributes. Relationship expansion shows schema paths; it is not by itself a proof of why access was granted.</p>`,
  about: () => `<p>Design 01 · Resource-first explorer. A compact, calm workspace with a large resource tree and a narrower access inspector.</p><ul class="dialog-list"><li>Top-right principal picker, inspired by eDrive.</li><li>Square plus/minus disclosure, distinct row selection, and aligned counts adapted from 0tx and Peach Explorer.</li><li>Arrow keys navigate visible tree rows. Right expands or enters a branch; Left collapses or returns to its parent; Enter selects.</li><li>Filtering temporarily reveals matching ancestors. Clearing it restores saved expansion.</li><li>Use the theme control to compare light and dark treatments. Use the row-density control to compare comfortable and compact layouts.</li><li>Production components, API behavior, and the separate caveats playground remain unchanged on this proposal branch.</li></ul><div class="dialog-note">This is a local interaction prototype, not a connected EACL demo. Sample decisions are a small deterministic fixture, not an authorization engine or benchmark.</div>`,
};
const dialogTitles = { principal: 'Explore as a principal', consistency: 'Consistency semantics', cache: 'Cache & diagnostics', dataset: 'Illustrative dataset', evidence: 'Query evidence', resource: 'Resource details', about: 'About this design' };
function openDialog(name, trigger = document.activeElement) {
  previousDialogFocus = trigger;
  $('#detail-dialog').dataset.content = name;
  $('#dialog-title').textContent = dialogTitles[name];
  $('#dialog-body').innerHTML = dialogBodies[name]();
  $('#detail-dialog').showModal();
  if (name === 'principal') $('#principal-filter').focus();
}
function closeDialog() { $('#detail-dialog').close(); }
$('#detail-dialog').addEventListener('close', () => previousDialogFocus?.focus());
$('#detail-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(); } });

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.dialog) openDialog(target.dataset.dialog, target);
  if (target.dataset.view) showView(target.dataset.view);
  if (target.dataset.toggle) toggle(target.dataset.toggle);
  if (target.dataset.select) selectResource(target.dataset.select, target.closest('[data-key]').dataset.key);
  if (target.dataset.more) { state.pages.set(target.dataset.more, (state.pages.get(target.dataset.more) || 1) + 1); state.focusKey = target.dataset.more; renderTree(); focusTree(target.dataset.more); log('lookup-resources', 'Next sample page', Number($('#page-size').value)); }
  if (target.dataset.permission) { state.permission = target.dataset.permission; state.selected = null; state.pages.clear(); renderExplorer(); log('lookup-resources', `${state.principal} · ${state.permission}`, accessible().length); }
  if (target.dataset.reverse) { state.reversePermission = target.dataset.reverse; renderInspector(); $(`[data-reverse="${state.reversePermission}"]`).focus(); log('lookup-subjects', `${state.selected} · ${state.reversePermission}`, principals.filter((person) => sampleAllowed(person.id, state.reversePermission, resourceById(state.selected))).length); }
  if (target.dataset.as) { setPrincipal(target.dataset.as); $('#principal-trigger').focus(); }
  if (target.dataset.principal) { setPrincipal(target.dataset.principal); closeDialog(); }
  if (target.id === 'clear-filter') { $('#resource-filter').value = ''; state.filter = ''; state.filterOverrides.clear(); renderTree(); $('#resource-filter').focus(); }
});
$('#principal-trigger').addEventListener('click', (event) => openDialog('principal', event.currentTarget));
$('#close-dialog').addEventListener('click', closeDialog);
$('#theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); });
$('#density-toggle').addEventListener('click', () => { state.compact = !state.compact; $('#density-toggle').setAttribute('aria-label', `Use ${state.compact ? 'comfortable' : 'compact'} rows`); savePreferences(); renderTree(); });
$('#view-access').addEventListener('click', () => { $('#access-pane').scrollIntoView({ block: 'start', behavior: 'instant' }); $('#access-title').tabIndex = -1; $('#access-title').focus({ preventScroll: true }); });
$('#collapse-all').addEventListener('click', () => { if (state.filter) treeNodes.forEach((node) => state.filterOverrides.set(node.key, false)); else state.expanded.clear(); state.focusKey = roots()[0].key; savePreferences(); renderTree(); });
$('#resource-filter').addEventListener('input', (event) => { state.filter = event.target.value; if (!state.filter) state.filterOverrides.clear(); renderTree(); });
$('#page-size').addEventListener('change', () => { state.pages.clear(); renderTree(); notify('Sample pagination reset to the first page.'); });
$('#consistency').addEventListener('change', (event) => { state.consistency = event.target.value; state.pages.clear(); renderTree(); openDialog('consistency', event.currentTarget); });
$('#requery').addEventListener('click', () => { log('re-query', state.consistency, accessible().length); notify('Re-ran the sample query. The sample snapshot is unchanged.'); });
$('#snapshot-refresh').addEventListener('click', () => { state.snapshot++; state.pages.clear(); state.selected = null; renderExplorer(); updateBasis(); log('refresh-snapshot', 'Illustrative snapshot transition', state.snapshot); notify('Simulated snapshot transition. No backend snapshot was refreshed.'); });
$('#backend').addEventListener('change', () => {
  const storage = { DataScript: ['Browser memory'], Datahike: ['S3', 'DynamoDB'], Datomic: ['DynamoDB'], Datalevin: ['In-memory'] }[$('#backend').value];
  $('#storage').innerHTML = storage.map((value) => `<option>${value}</option>`).join('');
  $('#execution').innerHTML = ($('#backend').value === 'DataScript' ? ['Browser'] : ['Lambda', 'EC2']).map((value) => `<option>${value}</option>`).join('');
  state.pages.clear(); state.selected = null; state.activity = []; $('#activity-count').textContent = '0'; renderExplorer();
  if (state.view === 'activity') renderActivity();
  $('#check-result').textContent = 'Ready to check';
  $('#query-summary').textContent = 'Ready to explore';
  notify('Profile layout changed. This preview still uses illustrative local data.');
});
for (const id of ['storage', 'execution']) $(`#${id}`).addEventListener('change', () => { state.pages.clear(); state.selected = null; state.activity = []; $('#activity-count').textContent = '0'; renderExplorer(); if (state.view === 'activity') renderActivity(); notify('Profile selection preview changed. No service was contacted.'); });
document.addEventListener('input', (event) => {
  if (event.target.id === 'principal-filter') {
    const term = event.target.value.toLowerCase();
    $$('.principal-option').forEach((option) => { option.hidden = !option.textContent.toLowerCase().includes(term); });
  }
  if (event.target.id === 'freshness-seconds') state.secondsAgo = Math.max(0, Number(event.target.value) || 0);
  if (event.target.id === 'freshness-date') state.at = event.target.value;
  if (event.target.id === 'exact-date') state.exactAt = event.target.value;
});
document.addEventListener('change', (event) => {
  if (event.target.closest('#check-form')) $('#check-result').textContent = 'Ready to check';
  if (event.target.id === 'cache-enabled') { state.cache = event.target.checked; $('#cache-summary').textContent = `Cache ${state.cache ? 'on' : 'off'}`; }
  if (event.target.id === 'populate-cache') state.populateCache = event.target.checked;
  if (event.target.id === 'freshness-mode') { state.freshnessMode = event.target.value; $('#dialog-body').innerHTML = consistencyBody(); $('#freshness-mode').focus(); }
});
$('#resource-tree').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key) || event.target.closest('[data-more]')) return;
  const rows = $$('[role=treeitem]', $('#resource-tree'));
  const current = event.target.closest('[role=treeitem]') || rows[0];
  if (!current) return;
  event.preventDefault();
  const node = treeNodes.get(current.dataset.key);
  const position = rows.indexOf(current);
  if (event.key === 'ArrowDown') focusTree(rows[Math.min(position + 1, rows.length - 1)].dataset.key);
  if (event.key === 'ArrowUp') focusTree(rows[Math.max(position - 1, 0)].dataset.key);
  if (event.key === 'Home') focusTree(rows[0].dataset.key);
  if (event.key === 'End') focusTree(rows.at(-1).dataset.key);
  if (event.key === 'ArrowRight') { if (current.hasAttribute('aria-expanded') && !isOpen(node.key)) toggle(node.key, true); else if (node.children.length && rows[position + 1]) focusTree(rows[position + 1].dataset.key); }
  if (event.key === 'ArrowLeft') { if (isOpen(node.key) && current.hasAttribute('aria-expanded')) toggle(node.key, false); else if (node.parent) focusTree(node.parent); }
  if (event.key === 'Enter' || event.key === ' ') { if (node.resource) selectResource(node.resource.id, node.key); else toggle(node.key); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#detail-dialog').open) { event.preventDefault(); showView('explorer'); $('#resource-filter').focus(); }
});
$('#check-principal').innerHTML = principals.map((principal) => `<option value="${principal.id}">${principal.name}</option>`).join('');
$('#check-resource').innerHTML = resources.map((resource) => `<option value="${resource.id}" ${resource.id === 'account-0-server-0' ? 'selected' : ''}>${resource.type}:${resource.id}</option>`).join('');
$('#check-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const resource = resourceById($('#check-resource').value);
  const permission = $('#check-permission').value;
  if (resource.type === 'platform' && permission === 'admin') {
    $('#check-result').textContent = 'Undefined permission';
    log('check-permission', 'platform has no admin permission', 'unsupported');
    return;
  }
  const allowed = sampleAllowed($('#check-principal').value, permission, resource);
  $('#check-result').innerHTML = `<span class="${allowed ? 'allowed' : 'denied'}">${allowed ? '✓ Allowed' : '− Denied'}</span> <small>· sample</small>`;
  log('check-permission', `${$('#check-principal').value} · ${permission} · ${resource.id}`, allowed ? 'Allowed' : 'Denied');
});
$('#resource-total').textContent = resources.length;
hydrateIcons(); applyTheme(); renderExplorer();
