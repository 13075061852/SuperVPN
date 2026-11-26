import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
const { createSubscriptionUsagePoller } = createRequire(import.meta.url)('../desktop/subscription-usage-poller.cjs');
const main = await fs.readFile('electron/main.cjs', 'utf8');
const automaticFunctions = main.slice(main.indexOf('async function fetchSubscriptionUsage('), main.indexOf('async function importSubscription('));
test('polling starts once at a one-minute interval and stops cleanly', async () => {
  const timers = [], cleared = [], module = { exports: {} }; let fetches = 0;
  vm.runInNewContext(await fs.readFile('desktop/subscription-usage-poller.cjs', 'utf8'), { module, Promise,
    setInterval: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearInterval: timer => cleared.push(timer)
  });
  const poller = module.exports.createSubscriptionUsagePoller({ list: () => [{ id: 'source' }], fetchUsage: async () => { fetches++; }, applyUsage: async () => {} });
  poller.start(); poller.start(); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 60000); assert.equal(fetches, 0);
  timers[0].fn(); await poller.tick(); assert.equal(fetches, 1);
  poller.dispose(); assert.equal(cleared[0], timers[0]); await poller.tick(); poller.start(); assert.equal(fetches, 1); assert.equal(timers.length, 1);
});
test('all subscriptions refresh independently and one failure does not prevent the others', async () => {
  const applied = [], fetched = [], sources = [{ id: 'bad' }, { id: 'one' }, { id: 'two' }];
  const poller = createSubscriptionUsagePoller({ list: () => sources,
    fetchUsage: async sub => { fetched.push(sub.id); if (sub.id === 'bad') throw new Error('private credential-bearing error'); return { usage: { total: 100 } }; },
    applyUsage: async sub => applied.push(sub.id)
  });
  await poller.tick(); assert.deepEqual(fetched, ['bad', 'one', 'two']); assert.deepEqual(applied, ['one', 'two']);
  await poller.tick(); assert.equal(applied.length, 4); poller.dispose();
});
test('busy work is skipped, cycles coalesce, and quitting discards in-flight results', async () => {
  let busy = true, release, fetched = 0, applied = 0;
  const poller = createSubscriptionUsagePoller({ list: () => [{ id: 'source' }], isBusy: () => busy,
    fetchUsage: () => { fetched++; return new Promise(resolve => release = resolve); }, applyUsage: () => applied++
  });
  await poller.tick(); assert.equal(fetched, 0); busy = false;
  const first = poller.tick(); assert.equal(poller.tick(), first); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetched, 1); poller.dispose(); release({ usage: {} }); await first; assert.equal(applied, 0);
});
function fixture({ failSave = false } = {}) {
  const node = { ...parseLink('http://active.example:8080'), id: 'active', subscriptionId: 'source' };
  const subscription = { id: 'source', name: 'Original', url: 'https://source.example/sub', usage: { total: 1000, download: 100 } };
  const state = { ...defaultState(), nodes: [node], selectedNodeId: node.id, subscriptions: [subscription],
    informationNodes: [{ id: 'info', name: '到期时间：2027-01-01', subscriptionId: 'source' }], nodeChecks: { active: { status: 'ok', delayMs: 42 } } };
  const session = { connected: true, nodeId: 'active', startedAt: 123, upload: 456 }; let saves = 0, broadcasts = 0;
  const forbidden = () => assert.fail('Metadata refresh must never affect the running core or proxy');
  const context = { state, session, busy: false, quitting: false, Date,
    save: async () => { saves++; if (failSave) throw new Error('disk failure'); }, broadcast: () => broadcasts++,
    fetchSubscription: async () => ({ body: 'not imported as nodes', usage: { total: 1000, download: 150 } }),
    subscriptionApi: { parseSubscription: () => ({ nodes: [{ id: 'replacement', outbound: { password: 'not-to-be-applied' } }], information: [] }) },
    start: forbidden, stop: forbidden, applyProxy: forbidden, recoverProxy: forbidden, fs: { writeFile: forbidden }
  };
  vm.createContext(context); vm.runInContext(automaticFunctions, context);
  return { context, state, session, subscription, fetch: context.fetchSubscriptionUsage, apply: context.applyAutomaticUsage, stats: () => ({ saves, broadcasts }) };
}
test('automatic refresh saves only provider usage and information, preserving nodes, selection, routing and session', async () => {
  const f = fixture(), beforeConfig = JSON.stringify(createConfig(f.state)), beforeSession = JSON.stringify(f.session);
  const result = await f.fetch(f.subscription); assert.equal(await f.apply(f.subscription, result), true);
  const next = f.context.state; assert.equal(next.subscriptions[0].usage.download, 150); assert.ok(next.subscriptions[0].usageUpdatedAt > 0);
  assert.equal(next.nodes, f.state.nodes); assert.equal(next.rules, f.state.rules); assert.equal(next.websiteRules, f.state.websiteRules);
  assert.equal(next.nodeChecks, f.state.nodeChecks); assert.equal(next.selectedNodeId, 'active'); assert.equal(f.context.session, f.session);
  assert.equal(JSON.stringify(f.session), beforeSession); assert.equal(JSON.stringify(createConfig(next)), beforeConfig);
  assert.deepEqual(f.stats(), { saves: 1, broadcasts: 1 }); assert.equal(f.context.busy, false);
});
test('stale responses cannot recreate deleted subscriptions or overwrite manual refresh, rename or URL changes', async () => {
  for (const patch of [[], [{ id: 'source', url: 'https://replacement.example/sub' }], [{ id: 'source', name: 'Renamed', usageUpdatedAt: Date.now() }]]) {
    const f = fixture(), result = await f.fetch(f.subscription);
    f.context.state = { ...f.state, subscriptions: patch };
    const current = f.context.state;
    assert.equal(await f.apply(f.subscription, result), false); assert.equal(f.context.state, current); assert.equal(f.stats().saves, 0);
  }
});
test('save failure, missing metadata, busy state and quitting all retain the last real data', async () => {
  const failed = fixture({ failSave: true });
  assert.equal(await failed.apply(failed.subscription, await failed.fetch(failed.subscription)), false);
  assert.equal(failed.context.state, failed.state); assert.equal(failed.context.busy, false);
  for (const condition of ['missing', 'busy', 'quitting']) {
    const f = fixture(); if (condition !== 'missing') f.context[condition] = true;
    const result = condition === 'missing' ? { usage: null, information: [] } : await f.fetch(f.subscription);
    assert.equal(await f.apply(f.subscription, result), false); assert.equal(f.context.state, f.state); assert.equal(f.stats().saves, 0);
  }
});
test('backend owns the timer independently of the source page and disposes it on quit', () => {
  assert.match(main, /usagePoller = createSubscriptionUsagePoller\(/); assert.ok(main.includes('usagePoller.start();'));
  assert.match(main, /app.on\('before-quit', e => \{\s*usagePoller\?\.dispose\(\)/);
});
