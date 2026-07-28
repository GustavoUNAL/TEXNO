import { execSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const APP = 'texno';
const PORT = Number(process.env.PORT) || 3847;

function pm2Apps() {
  try {
    const out = execSync('pm2 jlist', { encoding: 'utf8', cwd: root });
    return JSON.parse(out || '[]');
  } catch {
    return [];
  }
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '0.0.0.0');
  });
}

const apps = pm2Apps();
const existing = apps.find((a) => a.name === APP);
const busy = await isPortBusy(PORT);

execSync('mkdir -p logs', { cwd: root, stdio: 'inherit' });

if (busy && !existing) {
  console.error(`\nPuerto ${PORT} ya está en uso y PM2 no gestiona "${APP}".`);
  console.error('Libera el puerto antes de arrancar:');
  console.error(`  sudo ss -tlnp | grep :${PORT}`);
  console.error('Si hay un node suelto: pm2 stop texno  (o mata el PID que muestre ss)\n');
  process.exit(1);
}

if (busy && existing?.pm2_env?.status !== 'online') {
  console.warn(`Puerto ${PORT} ocupado; reiniciando proceso PM2 "${APP}"…`);
}

if (existing) {
  console.log(`PM2: reiniciando ${APP}…`);
  execSync(`pm2 restart ${APP} --update-env`, { cwd: root, stdio: 'inherit' });
} else {
  console.log(`PM2: iniciando ${APP}…`);
  execSync('pm2 start ecosystem.config.cjs', { cwd: root, stdio: 'inherit' });
}

try {
  execSync('pm2 save', { cwd: root, stdio: 'inherit' });
} catch {
  // pm2 save puede fallar si no hay startup hook configurado
}

console.log(`\nTEXNO en http://0.0.0.0:${PORT}`);
console.log('Logs: npm run pm2:logs\n');
