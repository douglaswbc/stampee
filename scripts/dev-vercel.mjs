import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';

// Forward only server-side app settings to local Vercel Functions. In particular,
// do not pass personal CLI tokens from .env files to the function runtime.
const localEnv = loadEnv('development', process.cwd(), '');
const serverEnvNames = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_ORIGIN',
  'ZERNIO_ENCRYPTION_KEY',
  'COMMUNICATIONS_CRON_SECRET',
  'CRON_SECRET',
  'PUSH_CRON_SECRET',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
];
for (const name of serverEnvNames) {
  if (!process.env[name]?.trim() && localEnv[name] !== undefined) {
    process.env[name] = localEnv[name];
  }
}

const isWindows = process.platform === 'win32';
const child = spawn(isWindows ? 'npx.cmd' : 'npx', ['vercel', 'dev'], {
  env: process.env,
  shell: isWindows,
  stdio: 'inherit',
});

child.on('error', (error) => {
  process.stderr.write(`Unable to start Vercel dev: ${error.message}\n`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
