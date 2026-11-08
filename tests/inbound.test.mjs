import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'agentic-inbound-'));
after(() => rm(temporary, { recursive: true, force: true }));
const output = join(temporary, 'inbound.mjs');
await build({ entryPoints: ['workers/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { receiveEmail } = await import(pathToFileURL(output).href);

function fixture({ forwarding = false } = {}) {
  const records = new Map();
  const forwarded = [];
  const settings = { forwarding: { enabled: forwarding, email: 'owner@example.net' } };
  const env = {
    EMAIL_ADDRESSES: ['support@one.test', 'support@two.test', 'reply@one.test'],
    AUTO_DRAFT_ENABLED: 'false',
    BUCKET: {
      get: async () => ({ json: async () => settings }),
      put: async () => {},
    },
    MAILBOX: {
      idFromName: (id) => id,
      get: (mailboxId) => ({
        getEmail: async (id) => records.get(`${mailboxId}/${id}`),
        findThreadBySubject: async () => null,
        createEmail: async (folder, email) => records.set(`${mailboxId}/${email.id}`, { mailboxId, folder, ...email }),
      }),
    },
    EMAIL_AGENT: { idFromName: () => { throw new Error('Unexpected paid AI request'); } },
  };
  const ctx = { waitUntil: () => { throw new Error('Unexpected background inference'); } };
  const message = (to, headers = 'To: support@one.test') => {
    const raw = new TextEncoder().encode(`From: sender@example.net\r\n${headers}\r\nSubject: Inbound fixture\r\nMessage-ID: <fixture@example.net>\r\n\r\nHello\r\n`);
    return { to, rawSize: raw.length, raw: new Blob([raw]).stream(), forward: async (destination) => forwarded.push(destination) };
  };
  return { env, ctx, message, records, forwarded };
}

test('routes to the SMTP recipient when headers name a different managed mailbox', async () => {
  const f = fixture();
  await receiveEmail(f.message('support@two.test'), f.env, f.ctx);
  assert.equal([...f.records.values()][0].mailboxId, 'support@two.test');
});

test('accepts Bcc deliveries without a To header and normalizes plus recipients', async () => {
  const f = fixture();
  await receiveEmail(f.message('reply+ticket-token@one.test', 'Bcc: reply@one.test'), f.env, f.ctx);
  assert.equal([...f.records.values()][0].mailboxId, 'reply@one.test');
  assert.equal([...f.records.values()][0].recipient, 'reply+ticket-token@one.test');
});

test('preserves configured forwarding and archives a retry only once', async () => {
  const f = fixture({ forwarding: true });
  await receiveEmail(f.message('support@two.test'), f.env, f.ctx);
  const retry = await receiveEmail(f.message('support@two.test'), f.env, f.ctx);
  assert.equal(retry.status, 'duplicate');
  assert.equal(f.records.size, 1);
  assert.deepEqual(f.forwarded, ['owner@example.net', 'owner@example.net']);
});

test('business archive copies do not forward the original message a second time', async () => {
  const f = fixture({ forwarding: true });
  await receiveEmail(f.message('support@two.test'), f.env, f.ctx, { archiveOnly: true });
  assert.equal(f.records.size, 1);
  assert.deepEqual(f.forwarded, []);
});

test('rejects unknown recipients instead of placing them in a header-selected mailbox', async () => {
  const f = fixture();
  await assert.rejects(receiveEmail(f.message('unknown@two.test'), f.env, f.ctx), /No configured mailbox/);
  assert.equal(f.records.size, 0);
});

test('forwarding failures and truncated messages remain failed deliveries', async () => {
  const f = fixture({ forwarding: true });
  const message = f.message('support@one.test');
  message.forward = async () => { throw new Error('Forwarding failed'); };
  await assert.rejects(receiveEmail(message, f.env, f.ctx), /Forwarding failed/);
  const truncated = f.message('support@one.test');
  truncated.rawSize += 1;
  await assert.rejects(receiveEmail(truncated, f.env, f.ctx), /truncated/);
  assert.equal(f.records.size, 0);
});
