import { execFileSync } from 'node:child_process';

const app = 'https://agentic-inbox.21131911496283.workers.dev';
try {
  const token = execFileSync('/opt/homebrew/bin/cloudflared', [
    'access', 'token', '--app', app,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  if (!claims.exp || claims.exp * 1000 < Date.now() + 15000) {
    throw new Error('Expired session');
  }
  process.stdout.write(JSON.stringify({ 'cf-access-token': token }));
} catch {
  process.stderr.write(`Inbox login required. Run: cloudflared access login --quiet --app ${app}\n`);
  process.exitCode = 1;
}
