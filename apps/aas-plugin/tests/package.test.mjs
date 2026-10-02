import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateEndpoint, writePackage } from '../scripts/package.mjs';

test('public URLs reject loopback, credentials and arbitrary destinations; local output is explicitly local', () => {
  for (const value of ['http://example.com/mcp', 'https://localhost/mcp', 'https://user:pass@example.com/mcp', 'https://example.com/mcp?x=1', 'https://example.com/not-mcp']) assert.throws(() => validateEndpoint(value));
  assert.equal(validateEndpoint('https://example.com/mcp').protocol, 'https:');
  assert.throws(() => validateEndpoint('https://example.com/mcp', true));
  assert.throws(() => validateEndpoint('http://127.0.0.1/mcp'));
});

test('development package includes portable metadata and all workflow bodies without activation or app references', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'aas-plugin-package-'));
  try {
    const destination = path.join(temporary, 'package');
    writePackage(destination, validateEndpoint('http://127.0.0.1:3100/mcp', true), true);
    const manifest = JSON.parse(readFileSync(path.join(destination, 'plugin.json'), 'utf8'));
    assert.equal(manifest.extensions['com.openai'].interface.displayName, 'AAS Development');
    assert.equal(manifest.apps, undefined); assert.equal(manifest.hooks, undefined);
    assert.equal(manifest.extensions['com.openai'].apps, undefined); assert.equal(manifest.extensions['com.openai'].hooks, undefined);
    assert.equal(manifest.extensions['com.openai'].review.test_cases.positive.length, 5);
    assert.equal(manifest.extensions['com.openai'].review.test_cases.negative.length, 3);
    assert.deepEqual(manifest.extensions['com.openai'].publication.countries, []);
    assert.equal(manifest.extensions['com.openai'].review.commerce, false);
    const mcp = JSON.parse(readFileSync(path.join(destination, 'mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.aas.type, 'streamable-http');
    assert.equal(Object.keys(mcp.mcpServers).length, 1);
    assert.equal(readdirSync(path.join(destination, 'skills')).length, 3);
    for (const id of readdirSync(path.join(destination, 'skills'))) {
      const source = readFileSync(path.join(destination, 'skills', id, 'SKILL.md'), 'utf8');
      assert.match(source, /^---\nname:/); assert.match(source, /metadata:\n/); assert.match(source, /## Limitations/);
    }
    assert.throws(() => writePackage(destination, new URL('http://127.0.0.1:3100/mcp'), true), /never overwritten/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('public export fails closed without a verified recorded demo, never dropping the MCP', () => {
  assert.throws(() => writePackage(path.join(tmpdir(), 'aas-unverified-public-output'), new URL('https://example.com/mcp'), false), /recorded demo/);
});
