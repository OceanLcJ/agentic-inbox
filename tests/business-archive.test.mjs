import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'agentic-business-archive-'));
after(() => rm(temporary, { recursive: true, force: true }));
const output = join(temporary, 'archive.mjs');
await build({ entryPoints: ['operations/portfolio-inbox.ts'], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { processWithInboxArchive } = await import(pathToFileURL(output).href);

function fixture() {
  const raw = 'From: sender@example.net\r\n\r\nOriginal message';
  const message = { raw: new Blob([raw]).stream(), rawSize: raw.length, to: 'reply+token@one.test', from: 'sender@example.net', setReject() {} };
  const background = [];
  const received = [];
  const env = { PORTFOLIO_INBOX: { fetch: async (request) => { received.push({ to: request.headers.get('x-envelope-to'), raw: await request.text() }); return new Response(null, { status: 204 }); } } };
  return { raw, message, background, received, env, ctx: { waitUntil: (promise) => background.push(promise) } };
}

test('preserves the full original input and sends an additional copy with the SMTP envelope', async () => {
  const f = fixture();
  const result = await processWithInboxArchive(f.message, f.env, f.ctx, async (message) => {
    assert.equal(await new Response(message.raw).text(), f.raw);
    return 'original result';
  });
  await Promise.all(f.background);
  assert.equal(result, 'original result');
  assert.deepEqual(f.received, [{ to: 'reply+token@one.test', raw: f.raw }]);
});

test('does not archive rejected or failed business messages', async () => {
  const rejected = fixture();
  await processWithInboxArchive(rejected.message, rejected.env, rejected.ctx, async (message) => message.setReject('Invalid participant'));
  assert.deepEqual(rejected.received, []);
  const failed = fixture();
  await assert.rejects(processWithInboxArchive(failed.message, failed.env, failed.ctx, async () => { throw new Error('Original failure'); }), /Original failure/);
  assert.deepEqual(failed.received, []);
});

test('an archive outage does not change the accepted business result', async () => {
  const f = fixture();
  f.env.PORTFOLIO_INBOX.fetch = async () => new Response(null, { status: 503 });
  assert.equal(await processWithInboxArchive(f.message, f.env, f.ctx, async () => 'accepted'), 'accepted');
  await Promise.all(f.background);
});

test('a deployment without the archive binding keeps the original message object', async () => {
  const f = fixture();
  await processWithInboxArchive(f.message, {}, f.ctx, async (message) => assert.equal(message, f.message));
  assert.equal(f.background.length, 0);
});
