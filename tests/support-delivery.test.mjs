import assert from "node:assert/strict";
import { test, after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const temporary = await mkdtemp(join(tmpdir(), "support-delivery-"));
after(() => rm(temporary, { recursive: true, force: true }));
await build({
  entryPoints: ["workers/routes/support.ts", "workers/lib/support-store.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: temporary,
});
const { supportApp } = await import(
  pathToFileURL(join(temporary, "routes/support.js")).href
);
const { SupportStore } = await import(
  pathToFileURL(join(temporary, "lib/support-store.js")).href
);
function fixture(
  send = async () => ({ messageId: "provider-receipt@example.test" }),
) {
  const db = new DatabaseSync(":memory:");
  const store = new SupportStore({
    exec(q, ...p) {
      const rows = db.prepare(q).all(...p);
      return { toArray: () => rows };
    },
  });
  const copies = [];
  const messages = new Map();
  const calls = [];
  const desk = {
    beginReply: (id, r, operator) =>
      store.beginReply(id, r, undefined, operator),
    beginOutgoing: (r) => store.beginOutgoing(r),
    finishReply: (id, r) => store.finishReply(id, r),
    getCaseRecord: (id) => ({
      case: store.getCase(id),
      events: store.getEvents(id),
    }),
  };
  const stub = {
    getEmail: async (id) => messages.get(id),
    checkSendRateLimit: async () => null,
    createEmail: async (folder, data) => {
      copies.push({ folder, ...data });
      messages.set(data.id, data);
    },
  };
  const env = {
    SUPPORT_DESK: { idFromName: (x) => x, get: () => desk },
    MAILBOX: { idFromName: (x) => x, get: () => stub },
    BUCKET: {
      list: async () => ({
        objects: [{ key: "mailboxes/support@one.test.json" }],
      }),
    },
    EMAIL: {
      send: async (value) => {
        calls.push(value);
        return send(value);
      },
    },
  };
  const request = (path, body, service = false) =>
    supportApp.request(
      "http://inbox.test" + path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(service
            ? {
                "cf-access-jwt-assertion": `e30.${Buffer.from(JSON.stringify({ common_name: "service" })).toString("base64url")}.sig`,
              }
            : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );
  return { store, copies, messages, calls, request };
}
const compose = {
  operationId: "compose-operation-1",
  mailboxId: "support@one.test",
  to: "owner@example.test",
  subject: "QA mail",
  text: "A test message",
};
test("new mail awaits provider acceptance, stores the real message ID and deduplicates replay", async () => {
  let accepted = false;
  const f = fixture(async () => {
    await new Promise((r) => setTimeout(r, 5));
    accepted = true;
    return { messageId: "actual-provider-id@example.test" };
  });
  const response = await f.request("/send", compose);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(accepted, true);
  assert.equal(body.state, "accepted");
  assert.equal(f.copies[0].message_id, "actual-provider-id@example.test");
  assert.equal(f.copies[0].thread_id, compose.operationId);
  assert.equal(f.copies[0].recipient, compose.to);
  assert.equal((await f.request("/send", compose)).status, 200);
  assert.equal(f.calls.length, 1);
});
test("service identity cannot use owner sending endpoints", async () => {
  const f = fixture();
  assert.equal((await f.request("/send", compose, true)).status, 403);
  assert.equal(
    (await f.request("/cases/anything/operator-reply", {}, true)).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test("unknown delivery retains an uncertain case and never starts a second submission", async () => {
  const f = fixture(async () => {
    throw new Error("Connection interrupted");
  });
  const first = await f.request("/send", compose);
  const operation = await first.json();
  assert.equal(first.status, 502);
  assert.equal(operation.state, "uncertain");
  assert.equal(f.store.getCase(operation.caseId).delivery, "uncertain");
  assert.equal((await f.request("/send", compose)).status, 409);
  assert.equal(f.calls.length, 1);
  assert.equal(f.copies.length, 0);
});
test("manual replies bind to the case mailbox, thread, and original customer", async () => {
  const f = fixture();
  const item = f.store.registerInbound({
    mailboxId: "support@one.test",
    threadId: "thread-one",
    emailId: "inbound-one",
    subject: "Question",
    sender: "customer@example.test",
    date: new Date().toISOString(),
  });
  f.messages.set("inbound-one", {
    id: "inbound-one",
    thread_id: "thread-one",
    message_id: "inbound-message@example.test",
    sender: "customer@example.test",
    recipient: item.mailboxId,
    subject: item.subject,
    date: item.latestInboundAt,
    body: "Question",
  });
  const response = await f.request(`/cases/${item.id}/operator-reply`, {
    operationId: "manual-reply-operation",
    expectedVersion: item.version,
    text: "Here is the answer.",
    summary: "Owner answered",
    status: "waiting_customer",
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].from, item.mailboxId);
  assert.equal(f.calls[0].to, "customer@example.test");
  assert.equal(
    f.calls[0].headers["In-Reply-To"],
    "<inbound-message@example.test>",
  );
  assert.equal(f.copies[0].thread_id, "thread-one");
  assert.equal(f.copies[0].message_id, "provider-receipt@example.test");
});

test("missing provider receipts are uncertain and cannot be reported as successful sends", async () => {
  const f = fixture(async () => ({}));
  const response = await f.request("/send", compose);
  const operation = await response.json();
  assert.equal(response.status, 502);
  assert.equal(operation.state, "uncertain");
  assert.equal(f.copies.length, 0);
});
test("a definitive provider rejection leaves an auditable failure without a Sent copy", async () => {
  const f = fixture(async () => {
    throw Object.assign(new Error("Recipient suppressed"), {
      code: "E_RECIPIENT_SUPPRESSED",
    });
  });
  const response = await f.request("/send", compose);
  const operation = await response.json();
  assert.equal(response.status, 502);
  assert.equal(operation.state, "failed");
  assert.equal(f.store.getCase(operation.caseId).delivery, "failed");
  assert.equal(f.copies.length, 0);
});
