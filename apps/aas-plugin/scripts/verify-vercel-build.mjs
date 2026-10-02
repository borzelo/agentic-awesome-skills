import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('../../../', import.meta.url).pathname);
const config = JSON.parse(readFileSync(path.join(root, '.vercel/output/functions/api/aas-mcp.func/.vc-config.json'), 'utf8'));
const files = config.filePathMap ?? {};
const catalog = JSON.parse(readFileSync(path.join(root, 'data/aas-v1/catalog-manifest.v1.json'), 'utf8'));
for (const file of ['data/aas-v1/catalog-manifest.v1.json', '.tmp/aas-plugin/workbench.html', ...catalog.assets.map((asset) => asset.path)]) {
  if (!Object.hasOwn(files, file)) throw new Error(`Deployment is missing a required asset: ${file}`);
}
const bytes = Object.keys(files).reduce((total, file) => total + statSync(path.join(root, file)).size, 0);
if (bytes > 240 * 1024 * 1024) throw new Error('Deployment assets leave insufficient room below the Function size limit');
console.log(JSON.stringify({ status: 'verified', catalogDigest: catalog.catalogDigest, includedFiles: Object.keys(files).length, mappedBytes: bytes }));
