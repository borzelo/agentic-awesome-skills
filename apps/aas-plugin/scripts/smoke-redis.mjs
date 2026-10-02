import http from 'node:http';
import { evidenceArgs } from '../tests/evidence-fixture.mjs';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServerlessHandler } from '../src/serverless.mjs';
import { RedisSessionStore } from '../src/session-store.mjs';
// Run only with explicitly configured development/preview credentials, never print them.
const store = new RedisSessionStore({ url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN, namespace: 'aas-plugin-preview-smoke-v1' });
const server = http.createServer((req, res) => createServerlessHandler({ store, allowedHosts: ['127.0.0.1'] })(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
const client = new Client({ name: 'aas-cloud-store-smoke', version: '1' });
const transport = new StreamableHTTPClientTransport(url);
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 10);
  assert.equal((await client.callTool({ name: 'search_skills', arguments: { query: 'debugging', limit: 5 } })).isError, false);
  const composed = await client.callTool({ name: 'compose_stack', arguments: { name: 'preview-smoke', profile: { goals: ['debug'], projectType: 'JavaScript app', languages: ['javascript'], frameworks: [], constraints: [] }, targets: [{ host: 'codex', scope: 'project' }], skillIds: ['debugging-strategies'] } });
  assert.equal(composed.isError, false);
  assert.equal((await client.callTool({ name: 'inspect_stack', arguments: { manifest: composed.structuredContent.manifest } })).structuredContent.status, 'valid');
  assert.deepEqual((await client.callTool({ name: 'open_workbench', arguments: {} })).structuredContent.manifest, composed.structuredContent.manifest);
  const exported = await client.callTool({ name: 'export_selection_evidence', arguments: evidenceArgs(composed.structuredContent.manifestDigest) });
  assert.equal(exported.isError, false);
  assert.equal((await client.callTool({ name: 'inspect_selection_evidence', arguments: { evidence: exported.structuredContent.evidence, manifest: composed.structuredContent.manifest } })).structuredContent.status, 'valid');
  console.log('PASS: real Redis REST leases, durable snapshots and fresh-invocation MCP flow');
} finally {
  await transport.terminateSession().catch(() => {});
  await client.close(); server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
