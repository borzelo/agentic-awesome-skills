# Unified AAS plugin development

A separate HTTP deployment exposes the existing release-pinned Core catalog and
read-only tool semantics. The local stdio MCP and published installer are unchanged.
Three canonical workflow skills guide discovery, composition and review. The server
also exposes a self-contained MCP Apps Workbench built from the existing React page.

## Local verification

Use Node.js 22 or later. From the repository root:

```sh
npm ci --ignore-scripts
npm run app:install
npm run plugin:install
npm run plugin:build
npm run plugin:test
npm --prefix apps/aas-plugin start
```

The service binds to loopback at port 3100. In another terminal, create an explicitly
local development package from that live service:

```sh
npm run plugin:package -- --local --endpoint http://127.0.0.1:3100/mcp
```

The verifier discovers all ten tools and checks catalog identity before packaging.
The output is under `.tmp/aas-plugin/local-*/`, includes a portable plugin, a repo
marketplace, and `aas-development.zip`. It is not a public submission ZIP. Existing
host settings, plugins and cache entries are not changed. To test installation,
register the generated marketplace root using your client's supported flow.
Keep the source service running; a local connection is unavailable on web/mobile.

## Vercel deployment

The root `vercel.json` builds the website and self-contained plugin UI, then routes
`/mcp` to `api/aas-mcp.mjs`. Set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` (the Marketplace-provisioned
`KV_REST_API_URL` and `KV_REST_API_TOKEN` are also supported) in Vercel settings, and explicit `AAS_ALLOWED_HOSTS`.
Use separate `AAS_SESSION_NAMESPACE` values for preview and production. A shared
Redis snapshot and a per-session lease preserve factual traces across Function
instances. Results are sent after durable commit; missing configuration returns 503.
Test preview deployment, bundle size and live Redis behavior before production.
A free Preview-only Upstash store was provisioned with maintainer authorization;
automatic paid upgrades are disabled. The production endpoint is not provisioned.

## Alternative resident deployment

Build the container from the repository root using `apps/aas-plugin/Dockerfile`.
Set `AAS_ALLOWED_HOSTS` to the exact public hostname and serve `/mcp` behind HTTPS.
Public binding without an explicit host allowlist fails. Configure only explicit
`AAS_ALLOWED_ORIGINS` if browser-origin clients are required; missing Origin is
accepted for MCP native clients. Do not trust forwarded host headers or use wildcard
allowlists. `/healthz` reports package version and catalog digest, without requests,
file paths, session IDs or user data. The container runs as the unprivileged node user.

Use one instance or sticky routing: composition state and factual traces belong to
one unpredictable bearer MCP session. Sessions are bounded, expire after 15 minutes
of inactivity, and are removed on DELETE or process exit. Limit concurrent requests
and initialization traffic at the HTTPS ingress. Do not log request bodies, Origin,
IP addresses, query text, artifact fields or session IDs unless explicitly covered by
the deployed privacy policy and user controls. Infrastructure log defaults must be
reviewed before public deployment. The service stores no project files on disk.

The nine existing tools preserve Core structured results and `isError`. The added
`open_workbench` accepts no artifact uploads. Compose and evidence tools can render
Workbench; file and paste imports use the browser's existing bounded validators and
make no network requests. The isolated UI disables catalog downloads and feedback.
Unsupported UI hosts receive the same structured artifacts and a public Workbench
link. Browser checks do not certify semantic fit or replace full Core inspection.

## Publication boundary

See the [submission dossier](../../docs/plugin-submissions/aas-unified/README.md).
No endpoint, domain verification, business verification, demo recording, installed
client proof, legal attestations, or public publication is fabricated by this package.
The development exporter intentionally fails closed for public output until those
materials and the hosted policy coverage are verified. A public plugin must include
its MCP from its initial submission and cannot include app bindings or hooks.

Installing these three workflows does not install every catalog skill. The catalog
is accessible through the service; native skill installation remains client-owned.
The agent selects IDs; Core never ranks or makes skills unavailable based on metadata.
