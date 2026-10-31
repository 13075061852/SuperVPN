import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubscription } from '../shared/subscription.js';
const yaml = `proxies:
  - name: Reality example
    type: vless
    server: node.example
    port: 443
    uuid: 11111111-2222-4333-8444-555555555555
    network: tcp
    tls: true
    udp: true
    flow: xtls-rprx-vision
    servername: www.example.com
    client-fingerprint: chrome
    skip-cert-verify: true
    reality-opts:
      public-key: test-public-key
      short-id: 'abcd'
proxy-groups:
  - name: ignored
    type: select
    proxies: [DIRECT]
rules: [MATCH,DIRECT]
`;
test('Clash VLESS Reality preserves connection parameters while ignoring remote routing rules', () => {
  const result = parseSubscription(yaml), node = result.nodes[0];
  assert.equal(result.nodes.length, 1); assert.equal(node.name, 'Reality example'); assert.equal(node.insecureRequested, true);
  assert.equal(node.outbound.uuid, '11111111-2222-4333-8444-555555555555'); assert.equal(node.outbound.flow, 'xtls-rprx-vision');
  assert.equal(node.outbound.tls.server_name, 'www.example.com'); assert.equal(node.outbound.tls.utls.fingerprint, 'chrome');
  assert.equal(node.outbound.tls.reality.public_key, 'test-public-key'); assert.equal(node.outbound.tls.reality.short_id, 'abcd');
  assert.equal(node.outbound.tls.insecure, undefined); assert.equal('rules' in node, false);
});
test('Clash unsupported records are counted safely rather than discarding supported nodes', () => {
  const body = yaml.replace('proxy-groups:', '  - { name: Unavailable, type: vmess, server: private.example, port: 443, password: never-render }\nproxy-groups:');
  const result = parseSubscription(body); assert.equal(result.total, 2); assert.equal(result.skipped, 1);
  assert.equal(result.unsupported[0].name, 'Unavailable'); assert.equal(JSON.stringify(result.unsupported).includes('never-render'), false);
  assert.equal(JSON.stringify(result.unsupported).includes('private.example'), false);
});
test('Clash WS Trojan and grpc VLESS preserve supported transports and passwords', () => {
  const result = parseSubscription(`proxies:
- {name: websocket, type: trojan, server: node.example, port: 443, password: 'p:a@ss', network: ws, sni: web.example, ws-opts: {path: /proxy, headers: {Host: ws.example}}}
- {name: grpc, type: vless, server: node.example, port: 443, uuid: 11111111-2222-4333-8444-555555555555, network: grpc, grpc-opts: {grpc-service-name: service}}
`);
  assert.equal(result.nodes[0].outbound.password, 'p:a@ss'); assert.equal(result.nodes[0].outbound.transport.headers.Host, 'ws.example');
  assert.equal(result.nodes[1].outbound.transport.service_name, 'service');
});
test('malformed YAML, duplicate keys and unsupported custom tags never execute or leak content', () => {
  for (const body of ['proxies: []', 'proxies: [', 'proxies: []\nproxies: []', 'proxies: !!js/function function() {}']) assert.throws(() => parseSubscription(body));
  assert.throws(() => parseSubscription(yaml.replace('network: tcp', 'network: tcp\n    packet-encoding: xudp')));
});
