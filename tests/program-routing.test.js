import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { manualProgress, parseRemaining } from '../src/quota-settings.js';
import { programView } from '../src/program-presentation.js';
const require = createRequire(import.meta.url);
const { normalizePrograms, createProgramScanner } = require('../desktop/programs.cjs');
const { setProgramRule } = require('../desktop/program-rules.cjs');
let vite, cache, ProgramRouting;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-program-test-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ProgramRouting = (await vite.ssrLoadModule('/src/ProgramRouting.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('program discovery groups case-insensitive exe names, preserves source paths and running status', () => {
  const rows = [{ path: 'C:\\App\\Browser.exe', name: 'Browser', source: 'running', running: true }, { path: 'D:\\App\\browser.EXE', name: '网页浏览器', source: 'start-menu' }, { path: '\\\\network\\bad.exe' }, { path: 'C:\\bad.exe --secret' }, { path: 'C:\\bad.txt' }];
  const result = normalizePrograms(rows); assert.equal(result.programs.length, 1); assert.equal(result.programs[0].paths.length, 2); assert.equal(result.programs[0].running, true); assert.equal(result.programs[0].name, '网页浏览器');
  assert.equal(result.programs[0].id, normalizePrograms(rows.slice(0, 1)).programs[0].id);
});
test('program scans coalesce, cache briefly and redact diagnostics', async () => {
  let count = 0, now = 0;
  const scan = createProgramScanner({ now: () => now, run: async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return '{"items":[]}'; } });
  await Promise.all([scan(), scan(true)]); assert.equal(count, 1);
  await scan(); assert.equal(count, 1); now = 31000; await scan(); assert.equal(count, 2);
  await scan(true); assert.equal(count, 3);
  await assert.rejects(createProgramScanner({ run: async () => { throw new Error('secret user folder'); } })(), e => !e.message.includes('secret') && /无法识别/.test(e.message));
});
test('per-program changes preserve other ordered rules, collapse duplicates and restore default by removal', () => {
  const state = { rules: [{ id: 'first', process: 'app.exe', action: 'direct', enabled: false }, { id: 'other', process: 'other.exe', action: 'reject', enabled: true }, { id: 'duplicate', process: 'APP.EXE', action: 'proxy', enabled: true }] }, original = structuredClone(state);
  const next = setProgramRule(state, { process: 'App.exe', action: 'proxy' }); assert.equal(next.rules.length, 2); assert.equal(next.rules[0].id, 'first'); assert.equal(next.rules[0].enabled, true); assert.deepEqual(next.rules[1], state.rules[1]); assert.deepEqual(state, original);
  assert.deepEqual(setProgramRule(next, { process: 'app.exe', action: 'default' }).rules, [state.rules[1]]);
  assert.throws(() => setProgramRule(state, { process: 'C:\\app.exe', action: 'direct' })); assert.throws(() => setProgramRule(state, { process: 'app.exe', action: 'invalid' }));
});
test('program routing shows old rules even before discovery is available and locks connected changes', () => {
  const data = { environment: { desktop: true }, mode: 'system', session: { connected: true }, settings: { defaultAction: 'proxy' }, rules: [{ id: 'r1', process: 'browser.exe', action: 'direct', enabled: true }] };
  const html = renderToStaticMarkup(React.createElement(ProgramRouting, { data, busy: false }));
  assert.ok(html.includes('browser.exe')); assert.ok(html.includes('正常退出')); assert.equal(html.includes('routing-context'), false); assert.ok(html.includes('搜索系统程序'));
  assert.ok(html.match(/<select[^>]*aria-label="browser.exe 网络规则"[^>]*disabled/));
  assert.ok(html.includes('直连')); assert.ok(html.includes('拦截')); assert.ok(html.includes('跟随默认'));
});
test('program filters keep configured undetected apps and disabled rules, with stable case-insensitive identity', () => {
  const programs = [{ name: '浏览器', process: 'Browser.exe', running: true, paths: ['C:\\Browser.exe'] }, { name: '编辑器', process: 'edit.exe', running: false, paths: [] }];
  const rules = [{ id: 'r1', process: 'BROWSER.EXE', action: 'proxy', enabled: true }, { id: 'r2', process: 'custom.exe', action: 'direct', enabled: false }];
  const original = structuredClone({ programs, rules });
  let view = programView({ programs, rules }); assert.deepEqual(view.counts, { all: 3, running: 1, configured: 2 }); assert.equal(view.rows[0].process, 'Browser.exe');
  assert.equal(view.rows[0].rule.action, 'proxy');
  view = programView({ programs, rules, filter: 'running' }); assert.equal(view.rows.length, 1);
  view = programView({ programs, rules, filter: 'configured' }); assert.equal(view.rows.length, 2); assert.equal(view.rows.find(app => app.process === 'custom.exe').rule, undefined);
  assert.equal(programView({ programs, rules, query: '  BROWSER.EXE ' }).rows.length, 1);
  assert.equal(programView({ programs, rules, query: '编辑器', filter: 'running' }).rows.length, 0);
  assert.equal(programView({ programs, rules, query: '编辑器' }).rows.length, 1);
  assert.deepEqual({ programs, rules }, original);
});
test('routing UI has compact filters without a separate default path, header actions, repeated icons or a title count badge', async () => {
  const data = { environment: { desktop: true }, mode: 'tun', session: { connected: false }, settings: { defaultAction: 'proxy', outboundMode: 'rule' }, rules: [{ id: 'r', process: 'app.exe', action: 'reject', enabled: true }] };
  const html = renderToStaticMarkup(React.createElement(ProgramRouting, { data, busy: false }));
  assert.ok(html.includes('<h1>分流控制</h1>')); assert.ok(html.includes('程序筛选')); assert.ok(html.includes('已配置')); assert.equal(html.includes('aria-label="刷新程序列表"'), false);
  assert.equal(html.includes('添加规则'), false); assert.equal(html.includes('routing-context'), false); assert.equal(html.includes('下次连接生效</span>'), false);
  assert.ok(html.includes('<header class="page-header"><h1>分流控制</h1></header>'));
  assert.ok(html.includes('data-action="reject"')); assert.equal(html.includes('默认路径'), false); assert.equal(html.includes('aria-label="默认网络路径"'), false); assert.equal(html.includes('default-route'), false);
  const row = html.slice(html.indexOf('class="program-row"')).split('</select>')[0]; assert.equal(row.includes('<svg'), false);
  const css = await fs.readFile('src/styles.css', 'utf8');
  assert.match(css, /\.program-routing\s*\{[^}]*height: 100%;[^}]*min-height: 0/);
  assert.match(css, /\.program-list\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/);
  assert.match(css, /\.program-table\s*\{[^}]*flex: 1;[^}]*min-height: 0/);
});
test('manual total is never guessed from plan names and only computes valid bounded remaining data', () => {
  assert.equal(manualProgress(null, '429.43 GB'), null);
  const value = manualProgress(500, '429.43 GB'); assert.ok(value.manual); assert.ok(Math.abs(value.percent - 14.114) < .001);
  assert.equal(manualProgress(100, '429.43 GB'), null); assert.equal(manualProgress(500, '剩余未知'), null);
  assert.equal(parseRemaining('500G年卡'), null); assert.equal(parseRemaining('1.5 GiB'), Math.round(1.5 * 1024 ** 3));
});
