import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const stack = 'demo-eacl-datahike-serverless-domain';
const stackArn = 'arn:aws:cloudformation:us-east-1:843761893873:stack/' + stack + '/6f25f3a0-9d87-11f1-9107-12826034c1f1';
const distribution = 'EYDAU1XQ7KZLQ';
const origin = 'https://serverless-datahike.demo.eacl.dev';
const destination = 'https://demo.eacl.dev/';
const aws = (...args) => {
  const output = execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  return output.trim() ? JSON.parse(output) : {};
};
const wait = (...args) => execFileSync('aws', [...args, '--region', 'us-east-1'], {stdio: 'inherit', timeout: 25 * 60 * 1000});
assert.equal(process.env.GITHUB_REF, 'refs/heads/production');
assert.match(process.env.GITHUB_RUN_ID ?? '', /^[0-9]+$/);
assert.equal(aws('sts', 'get-caller-identity').Account, '843761893873');
const current = aws('cloudformation', 'describe-stacks', '--stack-name', stack).Stacks[0];
assert.equal(current.StackId, stackArn);
assert.ok(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(current.StackStatus));
assert.equal(current.Parameters.find(p => p.ParameterKey === 'DomainName').ParameterValue, 'serverless-datahike.demo.eacl.dev');
assert.equal(current.Parameters.find(p => p.ParameterKey === 'HostedZoneId').ParameterValue, 'Z05228481ZHF8BAKXOZB2');
assert.equal(current.Outputs.find(p => p.OutputKey === 'DistributionId').OutputValue, distribution);
const target = await fetch(destination);
assert.equal(target.status, 200);
assert.match(await target.text(), /<title>EACL Explorer<\/title>/);
await mkdir('target/legacy-redirect', {recursive: true});
const name = `legacy-redirect-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const change = aws('cloudformation', 'create-change-set', '--stack-name', stackArn,
  '--change-set-name', name, '--change-set-type', 'UPDATE',
  '--template-body', 'file://infra/legacy/serverless-datahike-redirect.json',
  '--parameters', 'ParameterKey=DomainName,UsePreviousValue=true', 'ParameterKey=HostedZoneId,UsePreviousValue=true');
wait('cloudformation', 'wait', 'change-set-create-complete', '--change-set-name', change.Id);
// Resolve property values so unchanged dependent DNS aliases are omitted.
const preview = aws('cloudformation', 'describe-change-set', '--change-set-name', change.Id, '--include-property-values');
const allowed = new Map([
  ['StaticSiteBucket', 'Remove'], ['StaticSiteBucketPolicy', 'Remove'],
  ['StaticSiteOriginAccessControl', 'Remove'], ['StaticSiteRewriteFunction', 'Modify'],
  ['ServerlessDistribution', 'Modify']
]);
assert.equal(preview.StackId, stackArn);
assert.ok(preview.Changes.length > 0);
for (const {ResourceChange: r} of preview.Changes) {
  assert.equal(r.Action, allowed.get(r.LogicalResourceId), `Unexpected change to ${r.LogicalResourceId}`);
  assert.ok(!r.Replacement || r.Replacement === 'False', `Replacement of ${r.LogicalResourceId}`);
  if (r.LogicalResourceId === 'StaticSiteBucket') assert.equal(r.PolicyAction, 'Retain');
}
await writeFile('target/legacy-redirect/change-set.json', JSON.stringify(preview, null, 2));
console.log(JSON.stringify(preview.Changes.map(({ResourceChange: r}) => ({resource: r.LogicalResourceId, action: r.Action, replacement: r.Replacement, policy: r.PolicyAction}))));
aws('cloudformation', 'execute-change-set', '--change-set-name', change.Id);
wait('cloudformation', 'wait', 'stack-update-complete', '--stack-name', stackArn);
wait('cloudfront', 'wait', 'distribution-deployed', '--id', distribution);
const checks = [];
for (const [method, path, expected] of [
  ['GET', '/', 301], ['HEAD', '/datahike/', 301],
  ['GET', '/datahike/assets/retired.js?cursor=must-not-forward&token=must-not-forward', 301],
  ['POST', '/datahike/api/check-permission', 410]
]) {
  const response = await fetch(origin + path, {method, redirect: 'manual'});
  assert.equal(response.status, expected, `${method} ${path}`);
  assert.equal(response.headers.get('location'), expected === 301 ? destination : null);
  checks.push({method, path, status: response.status, location: response.headers.get('location')});
}
await writeFile('target/legacy-redirect/complete.json', JSON.stringify({stack, distribution, destination, checks}, null, 2));
console.log(JSON.stringify({destination, checks}));
