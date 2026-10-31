import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('settings belongs to the shared upper navigation after logs, with no separate bottom-button styling', async () => {
  const source = await fs.readFile('src/main.jsx', 'utf8');
  const css = await fs.readFile('src/styles.css', 'utf8');
  const navigation = source.match(/const navigation = \[([^;]+)\];/)?.[1];
  assert.ok(navigation);
  assert.deepEqual([...navigation.matchAll(/id: '([^']+)'/g)].map(match => match[1]), ['overview', 'nodes', 'profiles', 'rules', 'logs', 'settings']);
  assert.ok(navigation.includes("label: '设置', icon: Settings"));
  assert.ok(source.includes('navigation.map'));
  assert.equal(source.includes('rail-settings'), false);
  assert.equal(css.includes('rail-settings'), false);
});

test('settings show system proxy without a TUN option or capture-mode dropdown', async () => {
  const source = await fs.readFile('src/main.jsx', 'utf8');
  assert.ok(source.includes('<Setting title="接管方式"><span>系统代理</span></Setting>'));
  assert.equal(source.includes('<option value="tun">'), false);
  assert.equal(source.includes('aria-label="流量接管模式"'), false);
});
