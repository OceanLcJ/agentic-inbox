import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseMultipart } from "./live-bridge.mjs";

export function createSupportSourceEntry(main) {
  return `export * from ${JSON.stringify("./" + main)};\nexport { default } from ${JSON.stringify("./" + main)};\nexport { SupportInboxSource } from './portfolio-support-source.mjs';\n`;
}
async function run() {
  const dir = ".local-setup/wbt-feedback-incident";
  const original = JSON.parse(
    await fs.readFile(`${dir}/wbt-settings-before.json`, "utf8"),
  ).result;
  const beforeDeployments = JSON.parse(
    await fs.readFile(`${dir}/wbt-deployments-before.json`, "utf8"),
  ).result;
  const type = await fs.readFile(`${dir}/wbt-content-type.txt`, "utf8");
  const parts = parseMultipart(
    await fs.readFile(`${dir}/wbt-content-before.bin`),
    type,
  );
  const main = (await fs.readFile(`${dir}/wbt-entrypoint.txt`, "utf8")).trim();
  assert(parts.some((p) => p.name === main));
  const entry = "portfolio-support-entry.mjs",
    source = "portfolio-support-source.mjs";
  assert(
    !parts.some((p) => [entry, source].includes(p.name)),
    "Support source already installed",
  );
  const sourceRoot = process.argv[process.argv.indexOf("--source-root") + 1];
  assert(
    sourceRoot?.startsWith("/"),
    "Pass --source-root /absolute/what-brandon-thinks",
  );
  const compiled = await build({
    entryPoints: [sourceRoot + "/workers/support-inbox-source.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    external: ["cloudflare:workers"],
    write: false,
  });
  const metadata = {
    main_module: entry,
    compatibility_date: original.compatibility_date,
    compatibility_flags: original.compatibility_flags,
    usage_model: original.usage_model,
    placement: original.placement,
    logpush: original.logpush,
    observability: original.observability,
    tail_consumers: original.tail_consumers,
    tags: original.tags,
    limits: original.limits,
    keep_assets: true,
    keep_bindings: ["secret_text", "assets"],
    bindings: original.bindings.filter(
      (b) => !["secret_text", "assets"].includes(b.type),
    ),
    annotations: {
      "workers/message":
        "Add private read-only contact form feed; preserve live application modules and assets",
    },
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  for (const p of parts) {
    const mime = p.name.endsWith(".wasm")
      ? "application/wasm"
      : p.name.endsWith(".bin")
        ? "application/octet-stream"
        : "application/javascript+module";
    form.append(p.name, new Blob([p.body], { type: mime }), p.name);
  }
  form.append(
    entry,
    new Blob([createSupportSourceEntry(main)], {
      type: "application/javascript+module",
    }),
    entry,
  );
  form.append(
    source,
    new Blob([compiled.outputFiles[0].contents], {
      type: "application/javascript+module",
    }),
    source,
  );
  const request = new Request("https://upload.invalid", {
    method: "PUT",
    body: form,
  });
  const body = Buffer.from(await request.arrayBuffer());
  const contentType = request.headers.get("content-type");
  const restored = parseMultipart(body, contentType);
  for (const p of parts)
    assert.deepEqual(
      restored.find((x) => x.name === p.name)?.body,
      p.body,
      "Changed original module " + p.name,
    );
  await fs.writeFile(`${dir}/wbt-source-upload.bin`, body, { mode: 0o600 });
  await fs.writeFile(
    `${dir}/wbt-source-upload.json`,
    JSON.stringify(
      { contentType, metadata, preservedModules: parts.length },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log({
    prepared: true,
    preservedModules: parts.length,
    preservedBindings: original.bindings.length,
    newModules: 2,
  });
  if (!process.argv.includes("--apply")) return;
  const authFile = await fs.readFile(
    "/Users/ocean/Library/Preferences/.wrangler/config/default.toml",
    "utf8",
  );
  const token = authFile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  assert(token);
  const api =
    "https://api.cloudflare.com/client/v4/accounts/4f3feebcfe518ef7bac59a926c43a2df/workers/scripts/what-brandon-thinks";
  const auth = { Authorization: "Bearer " + token };
  const liveSettings = await fetch(api + "/settings", { headers: auth }).then(
    (r) => r.json(),
  );
  assert.deepEqual(
    liveSettings.result,
    original,
    "Live settings changed; refresh before release",
  );
  const liveDeployments = await fetch(api + "/deployments", {
    headers: auth,
  }).then((r) => r.json());
  assert.deepEqual(
    liveDeployments.result.deployments[0]?.versions,
    beforeDeployments.deployments[0]?.versions,
    "Live version changed; refresh before release",
  );
  const live = await fetch(api, { headers: auth });
  const liveParts = parseMultipart(
    Buffer.from(await live.arrayBuffer()),
    live.headers.get("content-type"),
  );
  assert.equal(liveParts.length, parts.length);
  for (const p of parts)
    assert.deepEqual(liveParts.find((x) => x.name === p.name)?.body, p.body);
  const triggers = {};
  for (const endpoint of ["subdomain", "schedules", "routes"]) {
    const r = await fetch(api + "/" + endpoint, { headers: auth });
    const j = await r.json();
    assert(j.success, "Cannot read " + endpoint);
    triggers[endpoint] = j.result;
  }
  await fs.writeFile(
    `${dir}/wbt-triggers-before.json`,
    JSON.stringify(triggers),
    { mode: 0o600 },
  );
  const receipt = await fetch(api, {
    method: "PUT",
    headers: { ...auth, "content-type": contentType },
    body,
  }).then((r) => r.json());
  await fs.writeFile(
    `${dir}/wbt-source-release.json`,
    JSON.stringify(receipt),
    { mode: 0o600 },
  );
  assert(receipt.success, JSON.stringify(receipt.errors));
  const after = await fetch(api + "/settings", { headers: auth }).then((r) =>
    r.json(),
  );
  await fs.writeFile(`${dir}/wbt-settings-after.json`, JSON.stringify(after), {
    mode: 0o600,
  });
  assert.deepEqual(after.result.bindings, original.bindings);
  for (const field of [
    "compatibility_date",
    "compatibility_flags",
    "usage_model",
    "observability",
    "tail_consumers",
    "logpush",
    "placement",
  ])
    assert.deepEqual(after.result[field], original[field]);
  for (const endpoint of Object.keys(triggers)) {
    const r = await fetch(api + "/" + endpoint, { headers: auth }).then((r) =>
      r.json(),
    );
    assert.deepEqual(r.result, triggers[endpoint], "Changed " + endpoint);
  }
  const uploaded = await fetch(api, { headers: auth });
  const uploadedParts = parseMultipart(
    Buffer.from(await uploaded.arrayBuffer()),
    uploaded.headers.get("content-type"),
  );
  for (const p of parts)
    assert.deepEqual(
      uploadedParts.find((x) => x.name === p.name)?.body,
      p.body,
      "Deployed original module changed",
    );
  console.log({
    deployed: true,
    versionId: receipt.result?.version_id,
    preservedModules: parts.length,
    preservedBindings: original.bindings.length,
    preservedTriggers: Object.keys(triggers),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await run();
