import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const inboxUrl = 'https://agentic-inbox.21131911496283.workers.dev';
const serviceFile = new URL('../.local-setup/support-automation/access-service.json', import.meta.url);

export function getAccessHeaders() {
  let service;
  try { service = JSON.parse(readFileSync(serviceFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Inbox service credential file is invalid'); }
  if (service) {
    if (!service.clientId || !service.clientSecret || !service.expiresAt || !Number.isFinite(Date.parse(service.expiresAt)) || Date.parse(service.expiresAt) < Date.now() + 15000) {
      throw new Error('Inbox service credential is missing or expired');
    }
    return { 'CF-Access-Client-Id': service.clientId, 'CF-Access-Client-Secret': service.clientSecret };
  }
  const token = execFileSync('/opt/homebrew/bin/cloudflared', ['access', 'token', '--app', inboxUrl], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  if (!claims.exp || claims.exp * 1000 < Date.now() + 15000) throw new Error('Inbox user login expired');
  return { 'cf-access-token': token };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(getAccessHeaders())); }
  catch { process.stderr.write(`Inbox authentication needs attention. Renew its dedicated service credential, or run: cloudflared access login --quiet --app ${inboxUrl}\n`); process.exitCode = 1; }
}
