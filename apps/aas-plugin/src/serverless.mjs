import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createProtocolSession, REPO_ROOT, requestBody, reply } from './server.mjs';
const require = createRequire(import.meta.url);
const { McpServer } = require('../../../tools/lib/aas-v1/mcp');

export function createServerlessHandler({ store, root = REPO_ROOT, uiPath = fileURLToPath(new URL('../../../.tmp/aas-plugin/workbench.html', import.meta.url)), allowedHosts, allowedOrigins = [] }) {
  if (!store || !allowedHosts?.length || allowedHosts.includes('*') || allowedOrigins.includes('*')) throw new Error('Vercel requires a shared store and exact allowed hosts');
  const catalog = new McpServer({ root }).catalog;
  const html = readFileSync(uiPath, 'utf8');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const host = new URL(`https://${req.headers.host}`);
      if (!allowedHosts.includes(host.hostname) || host.username || host.password || host.pathname !== '/' || !req.url.startsWith('/') || req.url.startsWith('//')) { reply(res, 403, 'AAS_HTTP_HOST_REJECTED'); return; }
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) { reply(res, 403, 'AAS_HTTP_ORIGIN_REJECTED'); return; }
      if (req.url.split('?')[0] !== '/mcp') { reply(res, 404, 'AAS_HTTP_NOT_FOUND'); return; }
      const id = req.headers['mcp-session-id'];
      if (id && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) { reply(res, 404, 'AAS_HTTP_SESSION_NOT_FOUND'); return; }
      if (req.method === 'DELETE') {
        if (!id) { reply(res, 400, 'AAS_HTTP_SESSION_REQUIRED'); return; }
        await store.delete(id); res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST') { reply(res, 405, 'AAS_HTTP_METHOD_NOT_ALLOWED'); return; }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { reply(res, 415, 'AAS_HTTP_CONTENT_TYPE_REQUIRED'); return; }
      const body = await requestBody(req);
      if (!id && (body.method !== 'initialize' || !Object.hasOwn(body, 'id'))) { reply(res, 400, 'AAS_HTTP_INITIALIZE_REQUIRED'); return; }
      // Each invocation gets a fresh protocol server. Only a bounded session snapshot is shared.
      let outgoing;
      let outgoingId;
      const run = async (state, sessionId) => {
        const entry = createProtocolSession({ root, catalog, html, state });
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await entry.server.connect(transport);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (key !== 'mcp-session-id' && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        try {
          const request = new Request(`https://${req.headers.host}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
          const response = await transport.handleRequest(request, { parsedBody: body });
          outgoing = { status: response.status, headers: [...response.headers], body: Buffer.from(await response.arrayBuffer()) };
          outgoingId = sessionId;
          return entry.snapshot();
        } finally { await entry.server.close(); }
      };
      if (id) {
        if (body.method === 'initialize') { reply(res, 400, 'AAS_HTTP_ALREADY_INITIALIZED'); return; }
        await store.run(id, (state) => run(state, id));
      } else {
        const initial = createProtocolSession({ root, catalog, html }).snapshot();
        const sessionId = await store.create(initial);
        try { await store.run(sessionId, (state) => run(state, sessionId)); }
        catch (error) { await store.delete(sessionId).catch(() => {}); throw error; }
      }
      // Publish results only after durable state has been committed successfully.
      for (const [key, value] of outgoing.headers) res.setHeader(key, value);
      res.setHeader('mcp-session-id', outgoingId);
      res.writeHead(outgoing.status);
      res.end(outgoing.body);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const code = error.code ?? 'AAS_HTTP_REQUEST_FAILED';
      const status = code === 'AAS_HTTP_SESSION_NOT_FOUND' ? 404 : /BUSY|LIMIT/.test(code) ? 429 : code.includes('STORE') ? 503 : 400;
      reply(res, error.status ?? status, code, error.requestId ?? null);
    }
  };
}
