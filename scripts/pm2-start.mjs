import { execSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const APP = 'texno';
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || '0.0.0.0';

function pm2Apps() {
  try {
    const out = execSync('pm2 jlist', { encoding: 'utf8', cwd: root });
    return JSON.parse(out || '[]');
  } catch {
    return [];
  }
}

function getPm2Port(app) {
  const env = app?.pm2_env;
  if (!env) return null;
  const raw = env.env?.PORT ?? env.PORT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '0.0.0.0');
  });
}

async function waitForHealth(port, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startFresh() {
  execSync(`pm2 delete ${APP}`, { cwd: root, stdio: 'inherit' });
  execSync('pm2 start ecosystem.config.cjs', { cwd: root, stdio: 'inherit' });
}

const apps = pm2Apps();
const existing = apps.find((a) => a.name === APP);
const pm2Port = getPm2Port(existing);
const busy = await isPortBusy(PORT);

execSync('mkdir -p logs', { cwd: root, stdio: 'inherit' });

if (busy && !existing) {
  console.error(`\nPuerto ${PORT} ya está en uso y PM2 no gestiona "${APP}".`);
  console.error('Libera el puerto antes de arrancar:');
  console.error(`  sudo ss -tlnp | grep :${PORT}\n`);
  process.exit(1);
}

if (existing && pm2Port !== null && pm2Port !== PORT) {
  console.log(`PM2: recreando ${APP} (puerto cacheado ${pm2Port} → ${PORT})…`);
  startFresh();
} else if (existing) {
  console.log(`PM2: aplicando ecosystem.config.cjs a ${APP}…`);
  try {
    execSync(`pm2 reload ecosystem.config.cjs --update-env`, { cwd: root, stdio: 'inherit' });
  } catch {
    console.warn('PM2 reload falló; recreando proceso…');
    startFresh();
  }
} else {
  console.log(`PM2: iniciando ${APP}…`);
  execSync('pm2 start ecosystem.config.cjs', { cwd: root, stdio: 'inherit' });
}

try {
  execSync('pm2 save', { cwd: root, stdio: 'inherit' });
} catch {
  // pm2 save puede fallar si no hay startup hook configurado
}

const healthy = await waitForHealth(PORT);
if (healthy) {
  console.log(`\nTEXNO OK en http://${HOST}:${PORT}`);
  console.log('Health: curl http://localhost:' + PORT + '/api/health\n');
} else {
  console.error(`\nTEXNO no responde en el puerto ${PORT}.`);
  console.error('Diagnóstico:');
  console.error('  pm2 logs texno --lines 30');
  console.error('  ss -tlnp | grep node');
  console.error('  curl http://localhost:3000/api/health   # por si quedó el puerto viejo');
  console.error('\nRecrear desde cero: npm run pm2:reset\n');
  process.exit(1);
}
