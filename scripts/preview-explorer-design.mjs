import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { platformOptions } from '../packages/explorer-state/src/platforms.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const json = async (path) => JSON.parse(await read(path));
const sha256 = (body) => createHash('sha256').update(body).digest('hex');
const [artifact, runtime, manifest, schema, schemaSource, catalog] = await Promise.all([
  json('dist/datascript-runtime/artifact.json'), read('dist/datascript-runtime/datascript-runtime.js'),
  json('fixtures/manifests/fixture-10000.v1.json'), json('fixtures/schema-wire.v1.json'),
  read('fixtures/schema.v1.zed'), json('packages/contracts/backend-storage.v1.json'),
]).catch((error) => { throw new Error('Build the canonical runtime first: npm run build:datascript-runtime', { cause: error }); });
if (sha256(runtime) !== artifact.artifact.sha256 || sha256(schemaSource) !== schema.sha256 ||
    manifest.schema.digest !== `sha256:${schema.sha256}`) throw new Error('Preview artifact or canonical schema digest mismatch.');
const demoSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const metadata = JSON.stringify({
  identity: { profileId: 'datascript-browser-memory', demoSha, eaclSha: artifact.eaclCoreSha,
    artifactSha256: artifact.artifact.sha256, deploymentId: `local-design-${demoSha.slice(0, 8)}`,
    dataManifestSha256: manifest.digests.manifest.replace('sha256:', '') },
  manifest, schema, schemaSource: schemaSource.toString(), catalog,
  platforms: Object.fromEntries(catalog.backends.flatMap((backend) => backend.storages.map((storage) =>
    [`${backend.id}/${storage}`, platformOptions({ backend: backend.id, storage })]))),
});
const files = new Map([
  ['/', ['docs/design-preview/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['docs/design-preview/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['docs/design-preview/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['docs/design-preview/app.js', 'text/javascript; charset=utf-8']],
  ['/selection.mjs', ['packages/explorer-state/src/selection.mjs', 'text/javascript; charset=utf-8']],
  ['/platforms.mjs', ['packages/explorer-state/src/platforms.mjs', 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!['GET', 'HEAD'].includes(request.method) || (!files.has(path) && !['/runtime.js', '/preview-metadata.json'].includes(path))) {
    response.writeHead(404).end('Not found'); return;
  }
  try {
    const file = files.get(path);
    const body = file ? await read(file[0]) : path === '/runtime.js' ? runtime : metadata;
    const type = file?.[1] || (path === '/runtime.js' ? 'text/javascript; charset=utf-8' : 'application/json');
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(500).end('Preview file unavailable'); }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(process.env.EACL_DESIGN_PORT || 5198), '127.0.0.1', () => {
  console.log(`EACL design preview: http://127.0.0.1:${server.address().port}`);
  console.log(`Canonical 10,000-resource fixture · EACL ${artifact.eaclCoreSha.slice(0, 12)} · local DataScript`);
});
