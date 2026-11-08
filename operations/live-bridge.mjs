import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export function parseMultipart(buffer, contentType) {
  const boundary = '--' + contentType.split('boundary=')[1];
  const marker = Buffer.from('\r\n' + boundary);
  let cursor = Buffer.byteLength(boundary) + 2;
  const parts = [];
  while (cursor < buffer.length) {
    const split = buffer.indexOf('\r\n\r\n', cursor);
    if (split < 0) break;
    const headers = buffer.subarray(cursor, split).toString();
    const end = buffer.indexOf(marker, split + 4);
    if (end < 0) throw new Error('Truncated multipart module');
    const name = headers.match(/name="([^"]+)"/)?.[1];
    if (!name) throw new Error('Unnamed multipart module');
    parts.push({ name, body: buffer.subarray(split + 4, end) });
    cursor = end + marker.length + 2;
  }
  if (!parts.length) throw new Error('No Worker modules found');
  return parts;
}

export function createEntry(main) {
  return `import original from ${JSON.stringify('./' + main)};
import { processWithInboxArchive } from './portfolio-inbox.mjs';
export * from ${JSON.stringify('./' + main)};
export default {
  ...original,
  async email(message, env, ctx) {
    return processWithInboxArchive(message, env, ctx, async (originalMessage) => {
      const background = [];
      const originalContext = new Proxy(ctx, {
        get(target, property) {
          if (property === 'waitUntil') return (promise) => {
            background.push(Promise.resolve(promise));
            target.waitUntil(promise);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const result = await original.email(originalMessage, env, originalContext);
      await Promise.all(background);
      return result;
    });
  }
};
`;
}

async function run() {
  const dir = '.local-setup/live-oceanlcj-aigenmusic';
  const original = JSON.parse(await fs.readFile(`${dir}/settings.json`, 'utf8')).result;
  const download = JSON.parse(await fs.readFile(`${dir}/download.json`, 'utf8'));
  const parts = parseMultipart(await fs.readFile(`${dir}/modules.multipart`), download.contentType);
  const entryName = 'portfolio-email-bridge.mjs';
  assert(parts.some((part) => part.name === 'index.mjs'));
  assert(!parts.some((part) => part.name === entryName));
  const compiled = await build({ entryPoints: ['operations/portfolio-inbox.ts'], bundle: true, format: 'esm', write: false });
  const metadata = {
    main_module: entryName,
    compatibility_date: original.compatibility_date,
    compatibility_flags: original.compatibility_flags,
    usage_model: original.usage_model,
    placement: original.placement,
    logpush: original.logpush,
    observability: original.observability,
    tail_consumers: original.tail_consumers,
    tags: original.tags,
    keep_assets: true,
    keep_bindings: ['secret_text', 'assets'],
    bindings: [
      ...original.bindings.filter((b) => !['secret_text', 'assets'].includes(b.type)),
      { name: 'PORTFOLIO_INBOX', type: 'service', service: 'agentic-inbox', entrypoint: 'InboxArchive' },
    ],
    annotations: { 'workers/message': 'Preserve live release and mirror accepted support mail to private portfolio inbox' },
  };
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  for (const part of parts) {
    const type = part.name.endsWith('.wasm') ? 'application/wasm' : part.name.endsWith('.bin') ? 'application/octet-stream' : 'application/javascript+module';
    form.append(part.name, new Blob([part.body], { type }), part.name);
  }
  form.append(entryName, new Blob([createEntry('index.mjs')], { type: 'application/javascript+module' }), entryName);
  form.append('portfolio-inbox.mjs', new Blob([compiled.outputFiles[0].contents], { type: 'application/javascript+module' }), 'portfolio-inbox.mjs');
  const request = new Request('https://upload.invalid', { method: 'PUT', body: form });
  const body = Buffer.from(await request.arrayBuffer());
  const contentType = request.headers.get('content-type');
  const restored = parseMultipart(body, contentType);
  for (const part of parts) assert.deepEqual(restored.find((p) => p.name === part.name)?.body, part.body);
  await fs.writeFile(`${dir}/bridge-upload.multipart`, body, { mode: 0o600 });
  await fs.writeFile(`${dir}/bridge-upload.json`, JSON.stringify({ contentType, metadata, preservedModules: parts.length, payloadSha256: createHash('sha256').update(body).digest('hex') }, null, 2), { mode: 0o600 });
  console.log({ prepared: true, preservedModules: parts.length, newModules: 2, originalBindings: original.bindings.length, additionalBinding: 'PORTFOLIO_INBOX' });
  if (!process.argv.includes('--apply')) return;
  const credentials = await fs.readFile('/Users/ocean/Library/Preferences/.wrangler/config/default.toml', 'utf8');
  const token = credentials.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  assert(token, 'Wrangler login required');
  const api = 'https://api.cloudflare.com/client/v4/accounts/4f3feebcfe518ef7bac59a926c43a2df/workers/scripts/oceanlcj-aigenmusic';
  const auth = { Authorization: `Bearer ${token}` };
  const current = await fetch(api, { headers: auth });
  assert.equal(current.headers.get('etag'), download.headers.etag, 'Live Worker changed; inspect the new version before applying');
  await current.body?.cancel();
  const settings = await (await fetch(`${api}/settings`, { headers: auth })).json();
  assert.deepEqual(settings.result.bindings, original.bindings, 'Live bindings changed; inspect before applying');
  const response = await fetch(api, { method: 'PUT', headers: { ...auth, 'content-type': contentType }, body });
  const receipt = await response.json();
  await fs.writeFile(`${dir}/bridge-deploy-receipt.json`, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  assert(receipt.success, `Worker upload failed: ${JSON.stringify(receipt.errors)}`);
  const after = await (await fetch(`${api}/settings`, { headers: auth })).json();
  await fs.writeFile(`${dir}/settings-after.json`, JSON.stringify(after, null, 2), { mode: 0o600 });
  for (const binding of original.bindings) assert.deepEqual(after.result.bindings.find((b) => b.name === binding.name), binding);
  const archiveBinding = after.result.bindings.find((b) => b.name === 'PORTFOLIO_INBOX');
  assert.equal(archiveBinding?.service, 'agentic-inbox');
  assert.equal(archiveBinding?.entrypoint, 'InboxArchive');
  for (const field of ['compatibility_date', 'compatibility_flags', 'usage_model', 'observability', 'tail_consumers', 'logpush', 'placement']) assert.deepEqual(after.result[field], original[field]);
  const triggers = JSON.parse(await fs.readFile(`${dir}/triggers-before.json`, 'utf8'));
  for (const endpoint of Object.keys(triggers)) {
    const now = await (await fetch(`${api}/${endpoint}`, { headers: auth })).json();
    assert.deepEqual(now.result, triggers[endpoint].result, `Unexpected trigger change: ${endpoint}`);
  }
  console.log({ deployed: true, versionId: receipt.result?.version_id, preservedBindings: original.bindings.length, preservedTriggers: Object.keys(triggers) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
