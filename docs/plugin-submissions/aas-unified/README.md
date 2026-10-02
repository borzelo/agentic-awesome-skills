# Unified AAS plugin: submission preparation

This dossier prepares an independently published AAS plugin for the OpenAI plugin
directory. Directory acceptance and publisher verification have not been obtained.
The existing Codex and Claude catalog mirrors remain separate distributions.

## Publisher decisions

The maintainer specified **Agentic Awesome Skills (AAS)** as the business publisher,
worldwide availability, and a completely free product with no purchases or payments.
These are declared decisions, not evidence of a verified legal entity. Verification
must use the actual entity accepted by the publisher portal; do not invent company
registration details or represent OpenAI as the publisher.

## Package architecture

The portable root manifest uses `extensions["com.openai"]`. It contains three small
workflow skills: discovery, agent-owned composition, and artifact review. A single
HTTPS MCP exposes the existing nine read-only Core tools plus `open_workbench`.
The full release-pinned catalog and support files are read through MCP, rather than
installed as thousands of native skills. Local Core/CLI remain open source and
support offline use. Hosted filesystem inspection and installation are unavailable.

Workbench is the existing React artifact reviewer packaged as a self-contained MCP
Apps resource. It consumes tool results and validates explicit file/paste imports
in browser memory. Imports are not sent back to MCP. Unsupported UI hosts receive
structured results and a link to the public Workbench. Native Codex UI compatibility
must be tested separately; SDK and browser tests do not prove native rendering.
No app bindings or lifecycle hooks are included in the public design.

## Vercel deployment preparation

The existing repository-root Vercel project can serve `/mcp` through
`api/aas-mcp.mjs`. The function uses a fresh protocol server for each invocation and
persists bounded session snapshots in Redis. A response is returned only after its
snapshot is committed. Per-session leases reject concurrent mutation; idle snapshots
expire after 15 minutes. Limits are 32 active sessions and 4 MiB per snapshot. These
initial bounds require load testing before broad distribution.

Required secrets are `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the Marketplace-provisioned
`KV_REST_API_URL` and `KV_REST_API_TOKEN` are also supported), stored
in Vercel environment settings, never in Git or the plugin ZIP. Required configuration
is `AAS_ALLOWED_HOSTS`, containing exact approved hostnames. Preview hosts are accepted
from `VERCEL_URL`; production custom hosts must be explicit. Optional
`AAS_ALLOWED_ORIGINS` contains exact origins only. `AAS_SESSION_NAMESPACE` should be
different for preview and production so their quotas and snapshots are isolated.
An unconfigured function returns 503; it never silently uses process memory.

Use a preview deployment first. Test the complete initialize/discovery/read/compose/
inspect/evidence/delete flow across separate Function instances. Verify deployment
bundle size, execution duration, Redis lease operations and retention, infrastructure
logging, and the installed native client's Workbench. Then assign an approved stable
hostname such as `mcp.aaskills.tech`, verify DNS/TLS, and repeat the live checks there.
The current source branch must pass protected source review and canonical sync before
production publication. Generated catalog artifacts belong to canonical sync.

The maintainer authorized a free Upstash resource for preview on 2026-10-02.
`aas-plugin-sessions` was provisioned in the AAS OSS team, region `fra1`,
with `autoUpgrade=false`, `prodPack=false`, and eviction disabled. It is connected
to Preview only. No production deployment or DNS update has been performed.
The existing website project is not proof that the new endpoint is operational.

## Review materials and outstanding evidence

`apps/aas-plugin/plugin-source.json` includes five positive and three negative review
cases. Execute and record them using reviewer-owned, non-secret sample data. AAS
exports factual session traces only; absent/expired traces cannot be reconstructed.
Record a publicly accessible demo showing installation, catalog reading, stack
composition, Workbench and clear failure behavior. There is no demo URL yet.

Before producing the public ZIP, verify:

- A stable live HTTPS endpoint, supported-client installation, and actual UI rendering.
- The business publisher and domain using the portal's verification procedure.
- Privacy/terms/support URLs and their coverage of remote hosting, Redis session
  retention, project metadata explicitly submitted to evidence tools, infrastructure
  logs, deletion and support. Existing local-only documentation is insufficient.
- Actual worldwide eligibility in the portal, with no commerce declaration.
- The accessible demo, all positive/negative cases, and the exact package contents.

The exporter currently produces an explicitly local development ZIP only, checking
live tool discovery and catalog identity first. It refuses public output while the
above evidence is absent. Preparing a manifest or ZIP does not submit or publish it.

## Official references

- [Plugin architecture](https://developers.openai.com/plugins/build/plugins)
- [MCP server requirements](https://developers.openai.com/plugins/build/mcp-server)
- [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Submission](https://developers.openai.com/plugins/deploy/submission)
- [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
- [Vercel MCP deployment](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
