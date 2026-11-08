import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createEntry, parseMultipart } from '../operations/live-bridge.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'agentic-live-bridge-'));
after(() => rm(temporary, { recursive: true, force: true }));
await build({ entryPoints: ['operations/portfolio-inbox.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'portfolio-inbox.mjs') });

test('keeps arbitrary binary modules byte for byte', () => {
  const binary = Buffer.from([0, 255, 128, 1, 13, 10, 99]);
  const body = Buffer.concat([Buffer.from('--boundary\r\nContent-Disposition: form-data; name="font.bin"\r\n\r\n'), binary, Buffer.from('\r\n--boundary--\r\n')]);
  assert.deepEqual(parseMultipart(body, 'multipart/form-data; boundary=boundary')[0].body, binary);
});

test('waits for Nitro background processing and preserves unrelated handlers and exports', async () => {
  await writeFile(join(temporary, 'accepted.mjs'), `export const untouched = 42;
export default { fetch: () => 'original fetch', email(message, env, ctx) {
ctx.waitUntil((async () => { await new Response(message.raw).text(); globalThis.archiveBusinessFinished = true; })());
} };`);
  await writeFile(join(temporary, 'accepted-bridge.mjs'), createEntry('accepted.mjs'));
  const bridge = await import(pathToFileURL(join(temporary, 'accepted-bridge.mjs')).href);
  const background = [];
  const archived = [];
  globalThis.archiveBusinessFinished = false;
  const raw = 'Original business message';
  await bridge.default.email({ raw: new Blob([raw]).stream(), rawSize: raw.length, from: 'sender@example.net', to: 'support@one.test', setReject() {} }, {
    PORTFOLIO_INBOX: { fetch: async (request) => { assert.equal(globalThis.archiveBusinessFinished, true); archived.push(await request.text()); return new Response(null, { status: 204 }); } },
  }, { waitUntil: (promise) => background.push(promise) });
  await Promise.all(background);
  assert.deepEqual(archived, [raw]);
  assert.equal(bridge.default.fetch(), 'original fetch');
  assert.equal(bridge.untouched, 42);
  delete globalThis.archiveBusinessFinished;
});

test('recognizes rejection inside a Nitro background callback before archiving', async () => {
  await writeFile(join(temporary, 'rejected.mjs'), `export default { email(message, env, ctx) { ctx.waitUntil((async () => { await new Response(message.raw).text(); message.setReject('Invalid participant'); })()); } };`);
  await writeFile(join(temporary, 'rejected-bridge.mjs'), createEntry('rejected.mjs'));
  const bridge = await import(pathToFileURL(join(temporary, 'rejected-bridge.mjs')).href);
  const background = [];
  let rejected = false;
  await bridge.default.email({ raw: new Blob(['Rejected message']).stream(), rawSize: 16, from: 'sender@example.net', to: 'reply@one.test', setReject() { rejected = true; } }, {
    PORTFOLIO_INBOX: { fetch: async () => { throw new Error('Rejected mail must not be archived'); } },
  }, { waitUntil: (promise) => background.push(promise) });
  await Promise.all(background);
  assert.equal(rejected, true);
});
