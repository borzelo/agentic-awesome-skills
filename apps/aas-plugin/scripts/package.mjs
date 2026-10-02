import { readFileSync, writeFileSync, mkdirSync, cpSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const require = createRequire(import.meta.url);
const YAML = require('yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const skillIds = ['aas-discover', 'aas-compose-stack', 'aas-review-stack'];

export function validateEndpoint(value, local = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') throw new Error('Use an explicit /mcp URL without credentials, query or fragment');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local ? !loopback || url.protocol !== 'http:' : loopback || url.protocol !== 'https:') throw new Error('Public packages require verified HTTPS; local packages require loopback HTTP');
  return url;
}

export async function verifyEndpoint(url) {
  const client = new Client({ name: 'aas-package-verifier', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of ['search_skills', 'get_skill', 'list_skill_files', 'read_skill_file', 'compose_stack', 'inspect_stack', 'diff_stack', 'export_selection_evidence', 'inspect_selection_evidence', 'open_workbench']) {
      const tool = tools.tools.find((item) => item.name === name);
      if (!tool || !tool.annotations || ['readOnlyHint', 'destructiveHint', 'openWorldHint'].some((key) => typeof tool.annotations[key] !== 'boolean')) throw new Error(`Incomplete remote tool: ${name}`);
    }
    const result = await client.callTool({ name: 'search_skills', arguments: { query: '', limit: 1 } });
    const catalog = JSON.parse(readFileSync(path.join(root, 'data/aas-v1/catalog-manifest.v1.json'), 'utf8'));
    const repoVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    if (result.isError || result.structuredContent?.catalog?.version !== repoVersion || result.structuredContent?.catalogDigest !== catalog.catalogDigest) throw new Error('Endpoint catalog differs from the package source');
  } finally { await transport.terminateSession().catch(() => {}); await client.close(); }
}

export function writePackage(destination, endpoint, local) {
  if (lstatSafe(destination)) throw new Error('Use a fresh package destination; existing outputs are never overwritten');
  const manifest = JSON.parse(readFileSync(new URL('../plugin-source.json', import.meta.url), 'utf8'));
  if (!local) {
    if (!manifest.extensions['com.openai'].review.demo_recording_url) throw new Error('Public ZIP blocked: reviewer-accessible recorded demo is missing');
    throw new Error('Public ZIP blocked: confirm hosted privacy/support coverage and verified publisher identity before enabling public export');
  }
  mkdirSync(destination, { recursive: true });
  manifest.extensions['com.openai'].interface.displayName = 'AAS Development';
  manifest.extensions['com.openai'].publication.release_notes += ' Local development package; not submitted or published.';
  writeFileSync(path.join(destination, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(destination, 'mcp.json'), `${JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { aas: { type: 'streamable-http', url: endpoint.href } } }, null, 2)}\n`);
  for (const id of skillIds) {
    const source = path.join(root, 'skills', id);
    if (readdirSync(source).some((name) => name !== 'SKILL.md')) throw new Error('Inspect new bundled files before packaging');
    const text = readFileSync(path.join(source, 'SKILL.md'), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error('Invalid canonical frontmatter');
    const data = YAML.parse(match[1]);
    const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => !['name', 'description'].includes(key)).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
    mkdirSync(path.join(destination, 'skills', id), { recursive: true });
    writeFileSync(path.join(destination, 'skills', id, 'SKILL.md'), `---\n${YAML.stringify({ name: data.name, description: data.description, metadata })}---\n${match[2]}`);
  }
  mkdirSync(path.join(destination, 'assets'));
  cpSync(path.join(root, 'apps/web-app/public/agentic-skills-logo.png'), path.join(destination, 'assets/aas-mark.png'));
  writeFileSync(path.join(destination, 'README.md'), '# AAS development plugin\n\nLocal testing only. Start the source service before installing this package from its generated marketplace. It is not a public submission ZIP and does not install the complete catalog.\n');
}
function lstatSafe(file) { try { return lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--local' || args[1] !== '--endpoint') throw new Error('Usage: npm run plugin:package -- --local --endpoint http://127.0.0.1:3100/mcp');
  const endpoint = validateEndpoint(args[2], true);
  await verifyEndpoint(endpoint);
  const output = path.join(root, '.tmp/aas-plugin', `local-${Date.now()}`);
  const destination = path.join(output, 'plugins/agentic-awesome-skills');
  writePackage(destination, endpoint, true);
  mkdirSync(path.join(output, '.agents/plugins'), { recursive: true });
  writeFileSync(path.join(output, '.agents/plugins/marketplace.json'), `${JSON.stringify({ name: 'aas-development', interface: { displayName: 'AAS Development' }, plugins: [{ name: 'agentic-awesome-skills', source: { source: 'local', path: './plugins/agentic-awesome-skills' }, policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' }] }, null, 2)}\n`);
  const archive = path.join(output, 'aas-development.zip');
  const zip = spawnSync('python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f,f.relative_to(p))', destination, archive], { encoding: 'utf8' });
  if (zip.status !== 0) throw new Error('Archive creation failed');
  process.stdout.write(`${JSON.stringify({ marketplaceRoot: output, pluginRoot: destination, archive, readiness: 'local-development-only' }, null, 2)}\n`);
}
