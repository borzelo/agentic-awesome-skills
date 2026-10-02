import test from 'node:test';
import { evidenceArgs } from './evidence-fixture.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServerlessHandler } from '../src/serverless.mjs';
import { MemorySessionStore, RedisSessionStore } from '../src/session-store.mjs';

async function start(t, store) {
  // Re-create the handler for every request, simulating independent Function instances.
  const server = http.createServer((req, res) => createServerlessHandler({ store, allowedHosts: ['127.0.0.1'] })(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return new URL(`http://127.0.0.1:${server.address().port}/mcp`);
}
async function connect(t, url) {
  const client = new Client({ name: 'function-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url));
  t.after(() => client.close());
  return client;
}
test('fresh Function instances preserve discovery, stack and UI state, and isolate clients', async (t) => {
  const url = await start(t, new MemorySessionStore());
  const a = await connect(t, url); const b = await connect(t, url);
  assert.equal((await a.listTools()).tools.length, 10);
  assert.equal((await a.callTool({ name: 'search_skills', arguments: { query: 'debugging', limit: 5 } })).isError, false);
  const args = { name: 'function-stack', profile: { goals: ['debug'], projectType: 'JavaScript application', languages: ['javascript'], frameworks: [], constraints: [] }, targets: [{ host: 'codex', scope: 'project' }], skillIds: ['debugging-strategies'] };
  const composed = await a.callTool({ name: 'compose_stack', arguments: args });
  assert.equal(composed.isError, false);
  const manifest = composed.structuredContent.manifest;
  assert.equal((await a.callTool({ name: 'inspect_stack', arguments: { manifest } })).structuredContent.status, 'valid');
  assert.deepEqual((await a.callTool({ name: 'open_workbench', arguments: {} })).structuredContent.manifest, manifest);
  const exported = await a.callTool({ name: 'export_selection_evidence', arguments: evidenceArgs(composed.structuredContent.manifestDigest) });
  assert.equal(exported.isError, false, JSON.stringify(exported.structuredContent));
  assert.deepEqual(exported.structuredContent.evidence.payload.client, { name: 'function-test', version: '1' });
  assert.deepEqual(exported.structuredContent.evidence.payload.processTrace.calls.map((call) => call.tool), ['search_skills', 'compose_stack', 'inspect_stack']);
  assert.equal((await a.callTool({ name: 'inspect_selection_evidence', arguments: { evidence: exported.structuredContent.evidence, manifest } })).structuredContent.status, 'valid');
  assert.equal((await b.callTool({ name: 'open_workbench', arguments: {} })).structuredContent.manifest, undefined);
  const evidence = await b.callTool({ name: 'export_selection_evidence', arguments: { manifestDigest: composed.structuredContent.manifestDigest } });
  assert.equal(evidence.isError, true);
});
test('failed durable commit never returns a successful tool response', async (t) => {
  const store = new MemorySessionStore();
  const url = await start(t, store);
  const client = await connect(t, url);
  store.run = async (id, operation) => { await operation(JSON.parse(store.entries.get(id).text)); const error = new Error('storage offline'); error.code = 'AAS_HTTP_SESSION_STORE_UNAVAILABLE'; throw error; };
  await assert.rejects(client.listTools(), /503|STORE_UNAVAILABLE/);
});
test('session lease prevents concurrent mutation and expired state is rejected', async () => {
  let now = 0; const store = new MemorySessionStore({ now: () => now });
  const id = await store.create({ value: 1 });
  let release; const held = store.run(id, async (state) => { await new Promise((resolve) => { release = resolve; }); return state; });
  await assert.rejects(store.run(id, async (state) => state), /SESSION_BUSY/);
  await assert.rejects(store.delete(id), /SESSION_BUSY/);
  release(); await held; now += 900001;
  await assert.rejects(store.run(id, async (state) => state), /SESSION_NOT_FOUND/);
});
test('Redis failures redact credentials and reject insecure configuration', async () => {
  assert.throws(() => new RedisSessionStore({ url: 'http://redis.example/', token: 'secret' }), /configuration/);
  const store = new RedisSessionStore({ url: 'https://redis.example/', token: 'private-token', fetcher: async () => { throw new Error('private-token'); } });
  await assert.rejects(store.create({}), (error) => error.message === 'AAS_HTTP_SESSION_STORE_UNAVAILABLE');
});
