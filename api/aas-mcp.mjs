import { createServerlessHandler } from '../apps/aas-plugin/src/serverless.mjs';
import { RedisSessionStore } from '../apps/aas-plugin/src/session-store.mjs';
let handler;
export default async function aasMcp(req, res) {
  try {
    if (!handler) {
      const allowedHosts = (process.env.AAS_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
      if (process.env.VERCEL_URL) allowedHosts.push(process.env.VERCEL_URL);
      const store = new RedisSessionStore({ url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN, namespace: process.env.AAS_SESSION_NAMESPACE ?? `aas-plugin-${process.env.VERCEL_ENV === 'production' ? 'production' : 'preview'}-v1` });
      handler = createServerlessHandler({ store, allowedHosts, allowedOrigins: (process.env.AAS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean) });
    }
    if (req.url?.split('?')[0] === '/api/aas-mcp') req.url = '/mcp';
    await handler(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'AAS_PLUGIN_NOT_CONFIGURED' }));
  }
}
