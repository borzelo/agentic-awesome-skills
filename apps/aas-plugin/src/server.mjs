import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const require = createRequire(import.meta.url);
const { McpServer, TOOL_DEFINITIONS, AGENT_SELECTION_CONTRACT, parseMcpRequestLine, MAX_LINE_BYTES } = require('../../../tools/lib/aas-v1/mcp');
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const UI_URI = 'ui://aas/workbench-v1.html';
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const uiMetadata = { ui: { resourceUri: UI_URI }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] } };
const OPEN_WORKBENCH = {
  name: 'open_workbench', title: 'Review an AAS stack',
  description: 'Open AAS Workbench to review the stack composed in this session and optional selection evidence. Explicitly imported files are checked in the browser only. Does not install skills, generate a filesystem plan, or send local files to the server.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations,
  _meta: uiMetadata,
};

function reply(res, status, code, id = null) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: code } }));
}

async function requestBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_LINE_BYTES) { const error = new Error('AAS_HTTP_BODY_TOO_LARGE'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return parseMcpRequestLine(Buffer.concat(chunks));
}

export function createProtocolSession({ root = REPO_ROOT, catalog, html, state }) {
  const version = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version;
  const core = new McpServer({ root, catalog: catalog });
  const entry = { core, touched: Date.now(), pending: 0, sequence: Promise.resolve(), artifacts: {} };
  const server = new Server({ name: 'agentic-awesome-skills', version }, {
    capabilities: { tools: {}, resources: {} },
    instructions: `Read-only AAS catalog. ${AGENT_SELECTION_CONTRACT} Project inspection and filesystem operations belong to the client. Workbench imports remain in browser memory. Sessions expire after inactivity; restart discovery and composition if your session expires.`,
  });
  entry.server = server;
  server.oninitialized = () => { core.clientInfo = server.getClientVersion() ?? core.clientInfo ?? null; };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    ...TOOL_DEFINITIONS.map((tool) => ({ ...tool, description: tool.description.replace('verified local AAS catalog', 'verified release-pinned AAS catalog'),
      ...(['compose_stack', 'export_selection_evidence'].includes(tool.name) ? { _meta: { ui: { resourceUri: UI_URI } } } : {}),
    })), OPEN_WORKBENCH,
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'open_workbench') {
      if (Object.keys(request.params.arguments ?? {}).length) return { isError: true, content: [{ type: 'text', text: 'open_workbench accepts no artifact uploads. Import files in the browser.' }] };
      return { content: [{ type: 'text', text: 'Review the session stack in Workbench, or explicitly import local artifacts. Browser checks do not certify skill suitability. Hosts without UI can inspect the returned manifest and use https://aaskills.tech/workbench/.' }],
        structuredContent: { ok: true, catalog: { package: catalog.package, version: catalog.version, integrity: catalog.digest }, ...entry.artifacts },
      };
    }
    // Core owns argument validation and all tool semantics. The HTTP layer does not choose skills.
    const response = await core.callTool({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: request.params });
    if (response.error) return { isError: true, content: [{ type: 'text', text: response.error.message }] };
    const result = response.result;
    if (!result.isError && result.structuredContent?.manifest) {
      entry.artifacts = { manifest: result.structuredContent.manifest };
    }
    if (!result.isError && result.structuredContent?.evidence) entry.artifacts.evidence = result.structuredContent.evidence;
    return result;
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: UI_URI, name: 'AAS Workbench', mimeType: 'text/html;profile=mcp-app' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== UI_URI) throw new Error('Unknown UI resource');
    return { contents: [{ uri: UI_URI, mimeType: 'text/html;profile=mcp-app', text: html,
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } },
    }] };
  });
  if (state) {
    if (state.schemaVersion !== 1 || state.catalogDigest !== catalog.digest) throw new Error('AAS_HTTP_SESSION_CATALOG_CHANGED');
    for (const key of ['selectionTrace', 'runtimeObservations', 'traceOverflow', 'clientInfo']) core[key] = state[key];
    for (const key of ['traceAttempts', 'traceLastFailure', 'manifestSessions']) core[key] = new Map(state[key]);
    entry.artifacts = state.artifacts;
  }
  entry.snapshot = () => ({
    schemaVersion: 1, catalogDigest: catalog.digest, artifacts: entry.artifacts,
    selectionTrace: core.selectionTrace, runtimeObservations: core.runtimeObservations,
    traceOverflow: core.traceOverflow, clientInfo: server.getClientVersion() ?? core.clientInfo,
    traceAttempts: [...core.traceAttempts], traceLastFailure: [...core.traceLastFailure], manifestSessions: [...core.manifestSessions],
  });
  return entry;
}

export function createPluginService({
  root = REPO_ROOT,
  uiPath = fileURLToPath(new URL('../../../.tmp/aas-plugin/workbench.html', import.meta.url)),
  allowedHosts = ['127.0.0.1', 'localhost', '[::1]'],
  allowedOrigins = [],
  maxSessions = 32,
  sessionTtlMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 128 || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 60 * 60 * 1000) throw new Error('Invalid session limits');
  if (!allowedHosts.length || allowedHosts.includes('*') || allowedOrigins.includes('*')) throw new Error('Explicit host and origin allowlists required');
  const version = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version;
  const verified = new McpServer({ root }); // Verify the catalog once, before accepting traffic.
  const html = readFileSync(uiPath, 'utf8');
  if (!html.includes('AAS Workbench') || /<script[^>]+src=|<link[^>]+stylesheet/i.test(html)) throw new Error('Build the self-contained Workbench UI first');
  const sessions = new Map();
  let creating = 0;
  const discard = async (id) => {
    const entry = sessions.get(id);
    if (!entry) return;
    sessions.delete(id);
    await entry.server.close();
  };
  const expire = async () => {
    for (const [id, entry] of sessions) if (now() - entry.touched >= sessionTtlMs && entry.pending === 0) await discard(id);
  };
  async function newSession() {
    const entry = createProtocolSession({ root, catalog: verified.catalog, html });
    const { server } = entry;
    entry.touched = now();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => { sessions.set(id, entry); },
    });
    entry.transport = transport;
    await server.connect(transport);
    return entry;
  }
  const listener = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let url;
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('Absolute targets rejected');
      const origin = new URL(`http://${req.headers.host}`);
      if (origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid host');
      url = new URL(req.url, origin);
    } catch { reply(res, 400, 'AAS_HTTP_HOST_INVALID'); return; }
    if (!allowedHosts.includes(url.hostname)) { reply(res, 403, 'AAS_HTTP_HOST_REJECTED'); return; }
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) { reply(res, 403, 'AAS_HTTP_ORIGIN_REJECTED'); return; }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, package: 'agentic-awesome-skills', version, catalogDigest: verified.catalog.digest })); return;
    }
    if (url.pathname !== '/mcp' || url.search) { reply(res, 404, 'AAS_HTTP_NOT_FOUND'); return; }
    if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, DELETE'); reply(res, 405, 'AAS_HTTP_METHOD_NOT_ALLOWED'); return; }
    await expire();
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId))) { reply(res, 404, 'AAS_HTTP_SESSION_NOT_FOUND'); return; }
    let entry = sessionId ? sessions.get(sessionId) : undefined;
    let reserved = false;
    if (sessionId && !entry) { reply(res, 404, 'AAS_HTTP_SESSION_NOT_FOUND'); return; }
    if (req.method === 'DELETE') {
      if (!entry) { reply(res, 400, 'AAS_HTTP_SESSION_REQUIRED'); return; }
      await discard(sessionId); res.writeHead(204); res.end(); return;
    }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { reply(res, 415, 'AAS_HTTP_CONTENT_TYPE_REQUIRED'); return; }
    let body;
    try { body = await requestBody(req); } catch (error) { reply(res, error.status ?? 400, error.code ?? error.message ?? 'AAS_HTTP_INVALID_REQUEST', error.requestId ?? null); return; }
    if (!entry) {
      if (body.method !== 'initialize' || !Object.hasOwn(body, 'id')) { reply(res, 400, 'AAS_HTTP_INITIALIZE_REQUIRED'); return; }
      if (sessions.size + creating >= maxSessions) { reply(res, 429, 'AAS_HTTP_SESSION_LIMIT'); return; }
      creating += 1;
      reserved = true;
      try { entry = await newSession(); } catch (error) { creating -= 1; throw error; }
    }
    if (entry.pending >= 32) { reply(res, 429, 'AAS_HTTP_QUEUE_FULL'); return; }
    entry.pending += 1; entry.touched = now();
    const work = entry.sequence.then(() => entry.transport.handleRequest(req, res, body));
    entry.sequence = work.catch(() => {});
    try { await work; } finally {
      entry.pending -= 1; entry.touched = now();
      if (reserved) creating -= 1;
      if (!entry.transport.sessionId) await entry.server.close();
    }
  };
  const server = http.createServer((req, res) => { listener(req, res).catch(() => {
    if (!res.headersSent) reply(res, 500, 'AAS_HTTP_REQUEST_FAILED'); else res.end();
  }); });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  const timer = setInterval(() => { expire().catch(() => {}); }, Math.min(sessionTtlMs, 60_000)); timer.unref();
  return { server, catalog: verified.catalog, async close() {
    clearInterval(timer);
    await Promise.all([...sessions.keys()].map(discard));
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

export { requestBody, reply };
