import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as websiteRules from '../shared/website-rules.js';
const state = { websiteRules: [{ id: 'website', domain: 'deepseek.com', action: 'direct', enabled: false }] };
test('browser opening resolves saved rule id to a validated HTTPS URL regardless of enabled state', () => {
  assert.equal(websiteRules.websiteRuleUrl(state, 'website'), 'https://deepseek.com/');
  assert.throws(() => websiteRules.websiteRuleUrl(state, 'missing'));
  assert.throws(() => websiteRules.websiteRuleUrl(state, 'https://attacker.example'));
  for (const domain of ['javascript:alert(1)', 'file:///C:/Windows', 'https://user:pass@example.com', 'example.com:444', 'example.com/path', 'a.com\\evil']) assert.throws(() => websiteRules.websiteRuleUrl({ websiteRules: [{ id: 'test', domain }] }, 'test'));
});
test('opening uses native default browser without changing proxy state, even while connected or handling other work', async () => {
  const main = await fs.readFile('electron/main.cjs', 'utf8');
  const start = main.indexOf("  if (method === 'openWebsite') {");
  const end = main.indexOf("  if (method === 'networkInfo')", start);
  assert.ok(start > 0); assert.ok(end < main.indexOf("  if (busy) throw"));
  const code = main.slice(start, end); const calls = [];
  const original = JSON.stringify(state);
  const run = vm.runInNewContext(`(async function(method, payload) { ${code} })`, { websiteRules, state, shell: { openExternal: async url => calls.push(url) }, view: () => 'view' });
  assert.equal(await run('openWebsite', 'website'), 'view');
  assert.deepEqual(calls, ['https://deepseek.com/']); assert.equal(JSON.stringify(state), original);
  await assert.rejects(run('openWebsite', 'missing')); assert.equal(calls.length, 1);
  const fail = vm.runInNewContext(`(async function(method, payload) { ${code} })`, { websiteRules, state, shell: { openExternal: async () => { throw new Error('sensitive OS details'); } }, view: () => 'view' });
  await assert.rejects(fail('openWebsite', 'website'), error => error.message === '无法打开默认浏览器，请检查系统浏览器设置');
});
