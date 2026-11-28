import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DOMESTIC_DIRECT_DOMAINS } from '../shared/default-website-rules.js';
import { parseSubscriptionUsage } from '../shared/subscription-usage.js';

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const androidSrcDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'app', 'supervpn', 'android');
const singBoxExe = path.join(rootDir, 'resources', 'core', 'sing-box.exe');

async function walkKtFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkKtFiles(full));
    else if (entry.name.endsWith('.kt')) files.push(full);
  }
  return files;
}

test('Android domestic direct domain presets stay synced with desktop shared list', async () => {
  const ktPath = path.join(androidSrcDir, 'data', 'DefaultWebsiteRules.kt');
  const source = await fs.readFile(ktPath, 'utf8');
  const blockMatch = source.match(/val DOMESTIC_DIRECT_DOMAINS: List<String> = listOf\(([\s\S]*?)\n\s*\)/);
  assert.ok(blockMatch, 'Android DefaultWebsiteRules.kt must define DOMESTIC_DIRECT_DOMAINS');
  const androidDomains = [...blockMatch[1].matchAll(/"([a-z0-9.-]+)"/g)].map(m => m[1]);
  assert.deepEqual(androidDomains, [...DOMESTIC_DIRECT_DOMAINS]);
});

test('Android Kotlin sources follow design system, contain zero emoji icons, and remove placeholder service', async () => {
  const files = await walkKtFiles(androidSrcDir);
  assert.ok(files.length >= 12, 'Expected modular Android UI and data source files');
  assert.equal(existsSync(path.join(androidSrcDir, 'SuperVpnService.kt')), false, 'Obsolete placeholder service must be removed');

  // Extended pictographic / flag regional indicators check
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    assert.equal(emojiRegex.test(content), false, `Emoji icon forbidden in ${path.relative(rootDir, file)}`);
  }

  const theme = await fs.readFile(path.join(androidSrcDir, 'ui', 'Theme.kt'), 'utf8');
  assert.match(theme, /0xFF7047D7/, 'Android theme should use the desktop purple primary color');

  const components = await fs.readFile(path.join(androidSrcDir, 'ui', 'Components.kt'), 'utf8');
  assert.match(components, /CardRadius\s*=\s*10\.dp/, 'Card radius must stay 10dp');
  assert.match(components, /SectionGap\s*=\s*12\.dp/, 'Section spacing must stay 12dp');

  const launcherFg = await fs.readFile(path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground.xml'), 'utf8');
  const launcherColors = await fs.readFile(path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'), 'utf8');
  assert.match(launcherFg, /M24,5 L11,5 L5,14 L18,14 L12,23 L4,23/, 'Android launcher foreground must match desktop brand S path');
  assert.match(launcherFg, /#7047D7/i, 'Android launcher foreground must use desktop brand purple');
  assert.match(launcherColors, /#F7F6FC/i, 'Android launcher background must use desktop icon tile background');
});

test('Android security invariants: Keystore AES-GCM storage, HTTPS-only subscriptions, and valid manifest', async () => {
  const store = await fs.readFile(path.join(androidSrcDir, 'data', 'Store.kt'), 'utf8');
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /AES\/GCM\/NoPadding/);

  const fetcher = await fs.readFile(path.join(androidSrcDir, 'data', 'SubscriptionFetcher.kt'), 'utf8');
  assert.match(fetcher, /parsed\.protocol\s*!=\s*"https"/);
  assert.match(fetcher, /ClashParser\.isClashYaml/);

  const manifest = await fs.readFile(path.join(rootDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android\.permission\.BIND_VPN_SERVICE/);
  assert.match(manifest, /<queries>/);
  assert.doesNotMatch(manifest, /QUERY_ALL_PACKAGES/);
});

test('Android and desktop subscription usage parsing share identical semantics', async () => {
  const header = 'upload=1024; download=2048; total=1048576; expire=1893456000';
  const desktopUsage = parseSubscriptionUsage(header);
  assert.deepEqual(desktopUsage, { upload: 1024, download: 2048, total: 1048576, expire: 1893456000 });
  assert.equal(parseSubscriptionUsage('upload=1; upload=2; download=3; total=4'), null);

  const fetcher = await fs.readFile(path.join(androidSrcDir, 'data', 'SubscriptionFetcher.kt'), 'utf8');
  assert.match(fetcher, /fun parseSubscriptionUsage/);
  assert.match(fetcher, /Subscription-Userinfo/);
});

test('Android ConfigBuilder routing & DNS schema validates cleanly with desktop sing-box core', { skip: process.platform !== 'win32' || !existsSync(singBoxExe) }, async () => {
  // Mirrors ConfigBuilder.kt output (with mixed inbound for Windows sing-box check)
  const config = {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { type: 'udp', tag: 'bootstrap', server: '223.5.5.5' },
        { type: 'https', tag: 'remote', server: '1.1.1.1', path: '/dns-query', detour: 'proxy' },
      ],
      rules: [
        { clash_mode: 'Direct', server: 'bootstrap' },
        { clash_mode: 'Rule', domain_suffix: ['baidu.com', 'bilibili.com'], server: 'bootstrap' },
      ],
      final: 'remote',
      strategy: 'ipv4_only',
    },
    inbounds: [
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 17890 },
    ],
    outbounds: [
      {
        type: 'vless',
        tag: 'proxy',
        server: 'example.com',
        server_port: 443,
        uuid: '11111111-2222-3333-4444-555555555555',
        tls: { enabled: true, server_name: 'example.com' },
      },
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { ip_is_private: true, action: 'route', outbound: 'direct' },
        { clash_mode: 'Direct', action: 'route', outbound: 'direct' },
        { clash_mode: 'Global', action: 'route', outbound: 'proxy' },
        { domain_suffix: ['ads.example.com'], action: 'reject' },
        { domain_suffix: ['api.example.com'], action: 'route', outbound: 'proxy' },
        { domain_suffix: ['baidu.com'], action: 'route', outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'bootstrap',
    },
    experimental: {
      clash_api: { external_controller: '127.0.0.1:19090', default_mode: 'Rule' },
    },
  };

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-android-check-'));
  const file = path.join(work, 'config.json');
  try {
    await fs.writeFile(file, JSON.stringify(config, null, 2));
    await execFileAsync(singBoxExe, ['check', '-c', file], { timeout: 10000 });
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});
