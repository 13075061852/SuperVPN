import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DOMESTIC_DIRECT_DOMAINS, DEPRECATED_DOMESTIC_DIRECT_DOMAINS, seedDomesticWebsiteRules } from '../shared/default-website-rules.js';
import { websiteRuleList, setWebsiteRule, removeWebsiteRule, normalizeDomain } from '../shared/website-rules.js';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
test('domestic presets contain valid unique non-overlapping explicit domains and exclude dead or overseas domains', () => {
  assert.equal(new Set(DOMESTIC_DIRECT_DOMAINS).size, DOMESTIC_DIRECT_DOMAINS.length);
  for (const domain of DOMESTIC_DIRECT_DOMAINS) {
    assert.equal(normalizeDomain(domain), domain);
    assert.equal(DOMESTIC_DIRECT_DOMAINS.some(other => other !== domain && domain.endsWith(`.${other}`)), false, `${domain} overlaps broader preset`);
  }
  for (const domain of ['baidu.com', 'qq.com', 'tencent.com', 'bilibili.com', 'bilivideo.cn', 'douyin.com', 'taobao.com', 'jd.com', 'deepseek.com', 'doubao.com', 'coze.cn', 'moonshot.cn', 'aliyun.com', 'aliyuncs.com', 'myqcloud.com', 'icbc.com.cn', 'edu.cn', 'douban.com', 'alipan.com', '12306.cn']) assert.ok(DOMESTIC_DIRECT_DOMAINS.includes(domain), domain);
  for (const domain of ['cn', 'com', 'tiktok.com', 'youtube.com', 'google.com', 'coze.com', 'bytedance.com', 'byteoversea.com', ...DEPRECATED_DOMESTIC_DIRECT_DOMAINS]) assert.equal(DOMESTIC_DIRECT_DOMAINS.includes(domain), false, domain);
});
test('new and old profiles gain direct defaults once without changing nodes, sources, settings or custom rules', () => {
  const original = { ...defaultState(), websiteRules: [{ id: 'custom', domain: 'DEEPSEEK.COM', action: 'proxy', enabled: false }, { id: 'com-cn', domain: 'com.cn', action: 'reject', enabled: true }] };
  const result = seedDomesticWebsiteRules(original);
  assert.equal(original.websiteRules.length, 2); assert.equal(result.nodes, original.nodes); assert.equal(result.subscriptions, original.subscriptions); assert.equal(result.settings, original.settings);
  assert.equal(result.websiteRules[0], original.websiteRules[0]);
  assert.equal(result.websiteRules.some(rule => rule.domain === 'icbc.com.cn' || rule.domain === 'sina.com.cn'), false, 'preset must not override an existing broader exception');
  assert.ok(result.websiteRules.slice(2).every(rule => rule.action === 'direct' && rule.enabled));
  assert.equal(websiteRuleList(result).length, result.websiteRules.length); assert.equal(seedDomesticWebsiteRules(result), result);
  assert.ok(seedDomesticWebsiteRules({ nodes: [] }).websiteRules.length > 180);
});
test('v1 to v2 migration prunes untouched dead/redundant presets, adds new scenarios, and respects user edits/deletions', () => {
  const v1State = {
    ...defaultState(),
    domesticWebsiteRulesVersion: 1,
    websiteRules: [
      { id: 'domestic-direct:baidu.com', domain: 'baidu.com', action: 'direct', enabled: true },
      // User deleted douyin.com in v1; v2 migration must NOT resurrect it.
      { id: 'domestic-direct:qwen.cn', domain: 'qwen.cn', action: 'direct', enabled: true },
      { id: 'domestic-direct:tongyi.aliyun.com', domain: 'tongyi.aliyun.com', action: 'direct', enabled: true },
      { id: 'domestic-direct:cloud.tencent.com', domain: 'cloud.tencent.com', action: 'direct', enabled: true },
      // User customized tencentcloud.com to proxy; migration must keep user customization.
      { id: 'domestic-direct:tencentcloud.com', domain: 'tencentcloud.com', action: 'proxy', enabled: true },
      // User manually added miui.com; migration must keep manual rules.
      { id: 'manual-miui', domain: 'miui.com', action: 'direct', enabled: true },
    ]
  };
  const upgraded = seedDomesticWebsiteRules(v1State);
  assert.equal(upgraded.domesticWebsiteRulesVersion, 2);
  assert.equal(upgraded.websiteRules.some(r => r.domain === 'qwen.cn'), false);
  assert.equal(upgraded.websiteRules.some(r => r.domain === 'tongyi.aliyun.com'), false);
  assert.equal(upgraded.websiteRules.some(r => r.domain === 'cloud.tencent.com'), false);
  assert.equal(upgraded.websiteRules.some(r => r.domain === 'douyin.com'), false, 'deleted v1 preset must stay deleted');
  assert.equal(upgraded.websiteRules.find(r => r.domain === 'tencentcloud.com')?.action, 'proxy');
  assert.equal(upgraded.websiteRules.find(r => r.domain === 'miui.com')?.id, 'manual-miui');
  assert.ok(upgraded.websiteRules.some(r => r.domain === 'tencent.com' && r.action === 'direct'));
  assert.ok(upgraded.websiteRules.some(r => r.domain === 'moonshot.cn' && r.action === 'direct'));
  assert.ok(upgraded.websiteRules.some(r => r.domain === 'icbc.com.cn' && r.action === 'direct'));
  assert.ok(upgraded.websiteRules.some(r => r.domain === 'edu.cn' && r.action === 'direct'));
  assert.equal(seedDomesticWebsiteRules(upgraded), upgraded);
});
test('edited, disabled and deleted presets remain that way across restarts', () => {
  let state = seedDomesticWebsiteRules(defaultState());
  state = setWebsiteRule(state, { domain: 'baidu.com', action: 'proxy' });
  state = setWebsiteRule(state, { domain: 'qq.com', action: 'direct', enabled: false });
  state = removeWebsiteRule(state, state.websiteRules.find(rule => rule.domain === 'douyin.com').id);
  const loaded = seedDomesticWebsiteRules(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.websiteRules.find(rule => rule.domain === 'baidu.com').action, 'proxy');
  assert.equal(loaded.websiteRules.find(rule => rule.domain === 'qq.com').enabled, false);
  assert.equal(loaded.websiteRules.some(rule => rule.domain === 'douyin.com'), false);
});
test('migration respects 1000 rule limit and avoids colliding with existing rule ids', () => {
  const state = { websiteRules: Array.from({ length: 998 }, (_, i) => ({ id: i === 0 ? 'domestic-direct:baidu.com' : `custom-${i}`, domain: `site${i}.example`, action: 'proxy', enabled: true })) };
  const result = seedDomesticWebsiteRules(state);
  assert.equal(result.websiteRules.length, 1000); assert.equal(new Set(result.websiteRules.map(rule => rule.id)).size, 1000);
  assert.equal(websiteRuleList(result).length, 1000);
});
test('presets generate direct suffix routes and direct DNS only in Rule mode while preserving specific custom routes', () => {
  const node = parseLink('http://proxy.example:8080');
  let state = seedDomesticWebsiteRules({ ...defaultState(), nodes: [node], selectedNodeId: node.id });
  state = setWebsiteRule(state, { domain: 'special.bilibili.com', action: 'proxy' });
  const config = createConfig(state), routes = config.route.rules;
  const broad = routes.findIndex(rule => rule.domain_suffix?.includes('bilibili.com'));
  const specific = routes.findIndex(rule => rule.domain_suffix?.includes('special.bilibili.com'));
  assert.ok(specific < broad); assert.equal(routes[broad].outbound, 'direct'); assert.equal(routes[broad].clash_mode, 'Rule');
  assert.equal(routes[specific].outbound, 'proxy');
  assert.ok(config.dns.rules.some(rule => rule.clash_mode === 'Rule' && rule.domain_suffix?.includes('bilibili.com') && rule.server === 'bootstrap'));
});
test('desktop migration is saved before startup window and autoconnection, without touching a live core', async () => {
  const main = await fs.readFile('electron/main.cjs', 'utf8');
  const begin = main.indexOf('const { seedDomesticWebsiteRules }');
  const finish = main.indexOf('connectionMode = await import', begin);
  assert.ok(begin > main.indexOf("fs.readFile(dataPath('state.bin'))"));
  assert.ok(finish < main.indexOf('    createWindow();'));
  const migration = main.slice(begin, finish);
  assert.ok(migration.includes('await save()')); assert.equal(migration.includes('stop('), false); assert.equal(migration.includes('start('), false);
});
