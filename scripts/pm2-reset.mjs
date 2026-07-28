import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const APP = 'texno';

try {
  execSync(`pm2 delete ${APP}`, { cwd: root, stdio: 'inherit' });
} catch {
  // no existía
}

execSync('mkdir -p logs', { cwd: root, stdio: 'inherit' });
execSync('pm2 start ecosystem.config.cjs', { cwd: root, stdio: 'inherit' });

try {
  execSync('pm2 save', { cwd: root, stdio: 'inherit' });
} catch {
  // opcional
}

console.log('\nTEXNO recreado. Verifica: curl http://localhost:3847/api/health\n');
