import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const template = JSON.parse(await readFile(new URL('../infra/legacy/serverless-datahike-redirect.json', import.meta.url), 'utf8'));
const context = vm.createContext({});
vm.runInContext(template.Resources.StaticSiteRewriteFunction.Properties.FunctionCode, context);
test('redirect drops all legacy paths and opaque request state', () => {
  for (const method of ['GET', 'HEAD']) {
    const r = context.handler({request: {method, uri: '/datahike/api/check', querystring: {cursor: {value: 'secret'}, next: {value: 'https://attacker.invalid'}}, headers: {authorization: {value: 'secret'}}}});
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers.location.value, 'https://demo.eacl.dev/');
    assert.ok(!JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('attacker'));
  }
});
test('retired API mutations cannot be forwarded to the new site', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const r = context.handler({request: {method}});
    assert.equal(r.statusCode, 410);
    assert.equal(r.headers.location, undefined);
  }
});
test('redirect covers every path and has no old data origin', () => {
  const d = template.Resources.ServerlessDistribution.Properties.DistributionConfig;
  assert.equal(d.CacheBehaviors, undefined);
  assert.equal(d.DefaultCacheBehavior.FunctionAssociations[0].EventType, 'viewer-request');
  assert.deepEqual(d.Origins.map(x => x.DomainName), ['demo.eacl.dev']);
  assert.deepEqual(Object.keys(template.Resources).sort(), ['DomainAliasIpv4', 'DomainAliasIpv6', 'DomainCertificate', 'ServerlessDistribution', 'StaticSiteRewriteFunction'].sort());
});
