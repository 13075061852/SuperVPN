import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('logs fill the content area below the header instead of reserving a fixed viewport offset', async () => {
  const css = await fs.readFile('src/styles.css', 'utf8');
  const app = await fs.readFile('src/main.jsx', 'utf8');
  assert.ok(app.includes("page === 'logs' ? 'logs-page'"));
  assert.match(css, /\.logs-page\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;/);
  assert.match(css, /\.logs-page \.log-list, \.logs-page \.empty-state\s*\{[^}]*flex: 1;[^}]*min-height: 0;/);
  const list = css.match(/\.log-list\s*\{([^}]+)\}/)?.[1];
  assert.ok(list?.includes('overflow: auto;'));
  assert.equal(/(?:max-)?height:\s*calc\(/.test(list), false);
});
