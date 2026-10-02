import { createPluginService } from './server.mjs';
const hosts = process.env.AAS_ALLOWED_HOSTS?.split(',').map((value) => value.trim()).filter(Boolean);
const bind = process.env.AAS_BIND ?? '127.0.0.1';
if (bind !== '127.0.0.1' && !hosts?.length) throw new Error('Public binding requires AAS_ALLOWED_HOSTS');
const port = Number(process.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const service = createPluginService({ ...(hosts ? { allowedHosts: hosts } : {}), allowedOrigins: process.env.AAS_ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [] });
service.server.listen(port, bind, () => process.stderr.write(`AAS plugin service listening on ${bind}:${port}\n`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { service.close().then(() => process.exit(0)); });
