import { randomUUID } from 'node:crypto';
const TTL_SECONDS = 900;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
function storeError(code) { const error = new Error(code); error.code = code; return error; }
function stateText(state) {
  const text = JSON.stringify(state);
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw storeError('AAS_HTTP_SESSION_STATE_LIMIT');
  return text;
}

// Used only by local integration tests; never selected by the Vercel production entrypoint.
export class MemorySessionStore {
  constructor({ now = Date.now } = {}) { this.entries = new Map(); this.busy = new Set(); this.now = now; }
  async create(state) {
    for (const [id, item] of this.entries) if (item.until <= this.now()) this.entries.delete(id);
    if (this.entries.size >= 32) throw storeError('AAS_HTTP_SESSION_LIMIT');
    const id = randomUUID(); this.entries.set(id, { text: stateText(state), until: this.now() + TTL_SECONDS * 1000 }); return id;
  }
  async run(id, operation) {
    const item = this.entries.get(id);
    if (!item || item.until <= this.now()) { this.entries.delete(id); throw storeError('AAS_HTTP_SESSION_NOT_FOUND'); }
    if (this.busy.has(id)) throw storeError('AAS_HTTP_SESSION_BUSY');
    this.busy.add(id);
    try {
      const result = await operation(JSON.parse(item.text));
      this.entries.set(id, { text: stateText(result), until: this.now() + TTL_SECONDS * 1000 });
    } finally { this.busy.delete(id); }
  }
  async delete(id) { if (this.busy.has(id)) throw storeError('AAS_HTTP_SESSION_BUSY'); this.entries.delete(id); }
}

export class RedisSessionStore {
  constructor({ url, token, fetcher = fetch, namespace = 'aas-plugin-v1' }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !token || !/^[a-z0-9-]{1,64}$/.test(namespace)) throw new Error('Invalid Redis REST configuration');
    this.url = parsed.href; this.token = token; this.fetcher = fetcher; this.prefix = namespace;
  }
  key(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw storeError('AAS_HTTP_SESSION_NOT_FOUND'); return `${this.prefix}:session:${id}`; }
  async command(...command) {
    try {
      const response = await this.fetcher(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Redis unavailable');
      const payload = await response.json();
      if (payload.error) throw new Error('Redis command failed');
      return payload.result;
    } catch { throw storeError('AAS_HTTP_SESSION_STORE_UNAVAILABLE'); }
  }
  async create(state) {
    const id = randomUUID(); const key = this.key(id);
    const result = await this.command('EVAL', "local t=redis.call('TIME'); local n=tonumber(t[1]); redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',n); if redis.call('ZCARD',KEYS[2])>=32 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',900); redis.call('ZADD',KEYS[2],n+900,KEYS[1]); redis.call('EXPIRE',KEYS[2],900); return 1", 2, key, `${this.prefix}:active`, stateText(state));
    if (result !== 1) throw storeError('AAS_HTTP_SESSION_LIMIT');
    return id;
  }
  async run(id, operation) {
    const key = this.key(id); const lease = randomUUID(); const lock = `${key}:lock`;
    if (await this.command('SET', lock, lease, 'NX', 'PX', 60_000) !== 'OK') throw storeError('AAS_HTTP_SESSION_BUSY');
    try {
      const text = await this.command('GET', key);
      if (typeof text !== 'string') throw storeError('AAS_HTTP_SESSION_NOT_FOUND');
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw storeError('AAS_HTTP_SESSION_STATE_LIMIT');
      const result = await operation(JSON.parse(text));
      // A stale worker cannot overwrite state after losing its lease.
      const saved = await this.command('EVAL', "if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',900); local t=redis.call('TIME'); redis.call('ZADD',KEYS[3],tonumber(t[1])+900,KEYS[1]); redis.call('EXPIRE',KEYS[3],900); return 1", 3, key, lock, `${this.prefix}:active`, lease, stateText(result));
      if (saved !== 1) throw storeError('AAS_HTTP_SESSION_BUSY');
    } finally {
      await this.command('EVAL', "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, lock, lease).catch(() => {});
    }
  }
  async delete(id) {
    const key = this.key(id);
    const result = await this.command('EVAL', "if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('DEL',KEYS[1]); redis.call('ZREM',KEYS[3],KEYS[1]); return 1", 3, key, `${key}:lock`, `${this.prefix}:active`);
    if (result !== 1) throw storeError('AAS_HTTP_SESSION_BUSY');
  }
}
