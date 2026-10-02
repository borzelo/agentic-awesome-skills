import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPluginService, UI_URI } from '../src/server.mjs';

async function start(t, options = {}) {
  const service = createPluginService(options);
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${service.server.address().port}/mcp`);
  t.after(() => service.close());
  return { service, url };
}
async function connect(t, url) {
  const client = new Client({ name: 'aas-plugin-integration', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  t.after(() => client.close());
  return { client, transport };
}
function composeArgs() {
  return { name: 'http-review', profile: { goals: ['debug'], projectType: 'JavaScript application', languages: ['javascript'], frameworks: [], constraints: ['preview only'] }, targets: [{ host: 'codex', scope: 'project' }], skillIds: ['debugging-strategies'] };
}

test('real HTTP discovery, bundle reading, composition and Workbench preserve Core results', async (t) => {
  const { service, url } = await start(t);
  const { client } = await connect(t, url);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 10);
  for (const tool of tools.tools) for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof tool.annotations[key], 'boolean');
  const search = await client.callTool({ name: 'search_skills', arguments: { query: 'debugging', limit: 20 } });
  assert.equal(search.isError, false);
  assert.equal(search.structuredContent.catalogDigest, service.catalog.digest);
  assert(search.structuredContent.results.some((skill) => skill.id === 'debugging-strategies'));
  const skill = await client.callTool({ name: 'get_skill', arguments: { id: 'debugging-strategies', includeContent: true } });
  assert.equal(skill.isError, false);
  const files = await client.callTool({ name: 'list_skill_files', arguments: { id: 'debugging-strategies', limit: 20 } });
  assert.equal(files.isError, false);
  const read = await client.callTool({ name: 'read_skill_file', arguments: { id: 'debugging-strategies', path: 'resources/implementation-playbook.md' } });
  assert.equal(read.isError, false);
  const composed = await client.callTool({ name: 'compose_stack', arguments: composeArgs() });
  assert.equal(composed.isError, false);
  assert.deepEqual(composed.structuredContent.manifest.skills, [{ id: 'debugging-strategies' }]);
  const inspected = await client.callTool({ name: 'inspect_stack', arguments: { manifest: composed.structuredContent.manifest } });
  assert.equal(inspected.structuredContent.status, 'valid');
  const opened = await client.callTool({ name: 'open_workbench', arguments: {} });
  assert.deepEqual(opened.structuredContent.manifest, composed.structuredContent.manifest);
  const resource = await client.readResource({ uri: UI_URI });
  assert.match(resource.contents[0].text, /AAS Workbench/);
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
  const bad = await client.callTool({ name: 'read_skill_file', arguments: { id: 'debugging-strategies', path: '../package.json' } });
  assert.equal(bad.isError, true);
});

test('session artifacts are isolated and expired sessions are rejected', async (t) => {
  let time = 10000;
  const { url } = await start(t, { now: () => time, sessionTtlMs: 1000 });
  const a = await connect(t, url); const b = await connect(t, url);
  const composed = await a.client.callTool({ name: 'compose_stack', arguments: composeArgs() });
  assert.equal(composed.isError, false);
  const opened = await b.client.callTool({ name: 'open_workbench', arguments: {} });
  assert.equal(opened.structuredContent.manifest, undefined);
  const foreignEvidence = await b.client.callTool({ name: 'export_selection_evidence', arguments: { manifestDigest: composed.structuredContent.manifestDigest } });
  assert.equal(foreignEvidence.isError, true);
  time += 1001;
  const response = await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': a.transport.sessionId } });
  assert.equal(response.status, 404);
});

test('HTTP rejects foreign hosts/origins, unknown sessions, oversized, ambiguous and non-JSON bodies', async (t) => {
  const { url } = await start(t);
  const foreignHost = await new Promise((resolve) => { const req = http.request(url, { method: 'POST', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.end(); });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(new URL('/healthz', url), { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': '00000000-0000-0000-0000-000000000000' } })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(262145) })).status, 413);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","method":"initialize","id":1,"id":2}' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 400);
  assert.equal((await fetch(url)).status, 405);
});

test('bounded sessions reject extra clients, then explicit termination frees capacity', async (t) => {
  const { url } = await start(t, { maxSessions: 1 });
  const first = await connect(t, url);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'capacity-test', version: '1' } } });
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 429);
  await first.transport.terminateSession();
  const response = await fetch(url, { method: 'POST', headers, body });
  assert.equal(response.status, 200);
});

test('open_workbench rejects artifact upload and missing evidence cannot fabricate a trace', async (t) => {
  const { url } = await start(t); const { client } = await connect(t, url);
  const opened = await client.callTool({ name: 'open_workbench', arguments: { plan: { secret: 'never-upload' } } });
  assert.equal(opened.isError, true);
  const exported = await client.callTool({ name: 'export_selection_evidence', arguments: { manifestDigest: `sha256-${'0'.repeat(64)}` } });
  assert.equal(exported.isError, true);
  assert.equal(exported.structuredContent.code, 'AAS_EVIDENCE_MANIFEST_SESSION_MISSING');
});
