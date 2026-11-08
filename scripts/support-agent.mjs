import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccessHeaders, inboxUrl } from './access-headers.mjs';

const directory = new URL('../.local-setup/support-automation/', import.meta.url);
const base = new URL(process.env.SUPPORT_INBOX_URL || inboxUrl);
const local = ['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:';
if (!local && base.origin !== inboxUrl) throw new Error('Refusing to send Inbox credentials to another host');
const stateFile = (name) => new URL(name, directory);
const readState = async (name, fallback = null) => {
  try { return JSON.parse(await fs.readFile(stateFile(name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const saveState = async (name, value) => {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = stateFile(name);
  const temporary = new URL(`${name}.${crypto.randomUUID()}.tmp`, directory);
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, target);
};
export async function requestInbox(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (!path.startsWith('/api/v1/support/') && !path.startsWith('/api/v1/mailboxes/')) throw new Error('Unsupported Inbox request path');
  const response = await fetch(new URL(path, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(55000),
    headers: { ...(local ? {} : getAccessHeaders()), 'content-type': 'application/json', 'x-support-actor': 'agent' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if ([301, 302, 401, 403].includes(response.status)) throw new Error('Inbox authentication failed; check the dedicated Access service credential');
  const value = await response.json().catch(() => ({ error: 'Inbox returned an unreadable response' }));
  if (!response.ok) {
    const error = new Error(value.error || value.summary || value.state || `Inbox request failed (${response.status})`);
    error.status = response.status; error.result = value; throw error;
  }
  return value;
}
async function packet(file) {
  if (!file) throw new Error('Provide an absolute JSON packet path');
  const path = resolve(file);
  const value = JSON.parse(await fs.readFile(path, 'utf8'));
  if (!value.operationId) {
    value.operationId = crypto.randomUUID();
    // Persist the operation ID before a write so an interrupted command can be replayed safely.
    await fs.writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  }
  return value;
}
async function precheck() {
  try {
    const scan = await requestInbox('/api/v1/support/scan', {});
    const pending = await requestInbox('/api/v1/support/dashboard?status=pending&limit=1');
    const processing = await requestInbox('/api/v1/support/dashboard?status=processing&limit=50');
    const stalled = processing.cases.some(item => Date.now() - Date.parse(item.updatedAt) > 90 * 60000);
    const running = pending.automation.runningUntil && Date.parse(pending.automation.runningUntil) > Date.now();
    await saveState('precheck.json', { checkedAt: new Date().toISOString(), scan, pending: pending.counts.pending, stalled });
    if (running) { console.log('An existing support run still owns the lease.'); return 1; }
    if (pending.counts.pending || stalled || scan.errors.length || pending.automation.lastError) { console.log(JSON.stringify({ pending: pending.counts.pending, stalled, scanErrors: scan.errors.length })); return 0; }
    console.log('No unhandled customer mail. Dashboard heartbeat refreshed.'); return 1;
  } catch (error) {
    const signature = String(error.message).slice(0, 1000);
    await saveState('precheck.json', { checkedAt: new Date().toISOString(), error: signature });
    const notified = await readState('error-notified.json');
    console.log('Support scan needs attention; see the private precheck record.');
    return notified?.signature === signature && Date.now() - Date.parse(notified.at) < 6 * 3600000 ? 1 : 0;
  }
}
async function main() {
  const [command, argument, file] = process.argv.slice(2);
  if (command === 'precheck') { process.exitCode = await precheck(); return; }
  if (command === 'ack-error') {
    const check = await readState('precheck.json');
    if (check?.error) await saveState('error-notified.json', { signature: check.error, at: new Date().toISOString() });
    console.log('Operational alert checkpoint saved.'); return;
  }
  let result;
  if (command === 'scan') result = await requestInbox('/api/v1/support/scan', {});
  else if (command === 'dashboard') result = await requestInbox(`/api/v1/support/dashboard?limit=50${argument && argument !== 'all' ? `&status=${encodeURIComponent(argument)}` : ''}`);
  else if (command === 'case') {
    if (!argument) throw new Error('Case ID required');
    const record = await requestInbox(`/api/v1/support/cases/${encodeURIComponent(argument)}`);
    const thread = await requestInbox(`/api/v1/mailboxes/${encodeURIComponent(record.case.mailboxId)}/threads/${encodeURIComponent(record.case.threadId)}`);
    result = { ...record, thread };
  } else if (command === 'claim') {
    const record = await requestInbox(`/api/v1/support/cases/${encodeURIComponent(argument)}`);
    result = await requestInbox(`/api/v1/support/cases/${encodeURIComponent(argument)}/update`, { operationId: crypto.randomUUID(), expectedVersion: record.case.version, status: 'processing', summary: '正在核对完整邮件线程与项目资料', nextAction: '' });
  } else if (['update', 'note', 'reply'].includes(command)) {
    result = await requestInbox(`/api/v1/support/cases/${encodeURIComponent(argument)}/${command}`, await packet(file));
  } else if (command === 'run-start') {
    const runId = crypto.randomUUID();
    result = await requestInbox('/api/v1/support/runs/start', { runId });
    await saveState('current-run.json', { runId, startedAt: new Date().toISOString() });
  } else if (command === 'run-finish') {
    const current = await readState('current-run.json');
    if (!current?.runId) throw new Error('No current run; inspect the dashboard lease before proceeding');
    const body = JSON.parse(await fs.readFile(argument, 'utf8'));
    result = await requestInbox('/api/v1/support/runs/finish', { runId: current.runId, summary: body.summary, error: body.error || '' });
    await fs.unlink(stateFile('current-run.json'));
  } else if (command === 'configure') {
    result = await requestInbox('/api/v1/support/automation', JSON.parse(await fs.readFile(argument, 'utf8')), 'PUT');
  } else {
    console.log('Support agent commands (set NODE_USE_ENV_PROXY=1 for network requests):\nprecheck | scan | dashboard [status] | case ID | claim ID\nupdate ID /abs/packet.json | note ID /abs/packet.json | reply ID /abs/packet.json\nrun-start | run-finish /abs/result.json | configure /abs/config.json | ack-error'); return;
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(JSON.stringify({ error: error.message, status: error.status, result: error.result })); process.exitCode = 1; }
}
