import assert from "node:assert/strict";
import { test, after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createSupportSourceEntry } from "../operations/support-source-bridge.mjs";
const temporary = await mkdtemp(join(tmpdir(), "inbox-source-"));
after(() => rm(temporary, { recursive: true, force: true }));
await build({
  entryPoints: [
    "workers/lib/support-source.ts",
    "workers/lib/support-store.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: temporary,
});
const { syncSupportSources } = await import(
  pathToFileURL(join(temporary, "support-source.js")).href
);
const { SupportStore } = await import(
  pathToFileURL(join(temporary, "support-store.js")).href
);
const requestId = "22222222-2222-4222-8222-222222222222";
const ackId = "33333333-3333-4333-8333-333333333333";
const replyId = "44444444-4444-4444-8444-444444444444";
const mailbox = "support@whatbrandonthinks.net";
function fixture(hasReply = true) {
  const db = new DatabaseSync(":memory:");
  const store = new SupportStore({
    exec(q, ...p) {
      const rows = db.prepare(q).all(...p);
      return { toArray: () => rows };
    },
  });
  const emails = new Map();
  const now = Date.now();
  const feed = {
    source: "what-brandon-thinks:contact-form:v1",
    requests: [
      {
        requestId,
        createdAt: now - 3000,
        expiresAt: now + 100000,
        customerEmail: "customer@example.test",
        subject: "Support request 22222222",
        text: "Question",
        html: "<p>Question</p>",
        sent: [
          {
            id: ackId,
            kind: "support_acknowledgement",
            subject: "Received",
            text: "Received",
            html: "<p>Received</p>",
            sentAt: now - 2000,
            providerMessageId: "<ack@example.test>",
          },
          ...(hasReply
            ? [
                {
                  id: replyId,
                  kind: "support_reply",
                  subject: "Re: request",
                  text: "Please provide the report URL.",
                  html: "<p>Please provide the report URL.</p>",
                  sentAt: now - 1000,
                  providerMessageId: "<reply@example.test>",
                },
              ]
            : []),
        ],
      },
    ],
    errors: [],
    nextCursor: null,
  };
  const desk = {
    registerInbound: (x) => store.registerInbound(x),
    recordSourceIntake: (...x) => store.recordSourceIntake(...x),
    recordSourceReply: (...x) => store.recordSourceReply(...x),
  };
  const stub = {
    getFolders: async () => [],
    importSupportEmail: async (folder, email) => {
      if (emails.has(email.id)) return false;
      emails.set(email.id, { ...email, folder });
      return true;
    },
  };
  const env = {
    WBT_SUPPORT_SYNC_START_AT: new Date(now - 60000).toISOString(),
    WBT_SUPPORT_SOURCE: { fetch: async () => Response.json(feed) },
    MAILBOX: { idFromName: (x) => x, get: () => stub },
    SUPPORT_DESK: { idFromName: (x) => x, get: () => desk },
  };
  return { store, env, feed, emails };
}
test("source bridge preserves original default handler and all original named exports", async () => {
  await writeFile(
    join(temporary, "original.mjs"),
    'export const originalNamed=42; export default {fetch:()=>"original",email:()=>"chat-import",scheduled:()=>"original-cron"};',
  );
  await writeFile(
    join(temporary, "portfolio-support-source.mjs"),
    "export class SupportInboxSource {}",
  );
  await writeFile(
    join(temporary, "wrapper.mjs"),
    createSupportSourceEntry("original.mjs"),
  );
  const result = await import(
    pathToFileURL(join(temporary, "wrapper.mjs")).href
  );
  assert.equal(result.default.fetch(), "original");
  assert.equal(result.default.email(), "chat-import");
  assert.equal(result.default.scheduled(), "original-cron");
  assert.equal(result.originalNamed, 42);
  assert.equal(typeof result.SupportInboxSource, "function");
});
test("active form and sent replies import once with correct sender, provider IDs and waiting state", async () => {
  const f = fixture();
  await syncSupportSources(f.env);
  await syncSupportSources(f.env);
  assert.equal(f.emails.size, 3);
  const item = f.store.dashboard().cases[0];
  assert.equal(item.sender, "customer@example.test");
  assert.equal(item.mailboxId, mailbox);
  assert.equal(item.status, "waiting_customer");
  assert.equal(
    f.emails.get("wbt-outbox:" + replyId).message_id,
    "reply@example.test",
  );
  assert.equal(
    f.store.getEvents(item.id).filter((e) => e.kind === "source_reply_accepted")
      .length,
    1,
  );
  const claimed = f.store.updateCase(
    item.id,
    {
      operationId: "claim-imported",
      expectedVersion: item.version,
      status: "processing",
      summary: "Checking source reply",
      nextAction: "",
    },
    "agent",
  );
  assert.throws(
    () =>
      f.store.beginReply(item.id, {
        operationId: "duplicate-source-reply",
        expectedVersion: claimed.version,
        claimId: "claim-imported",
        text: "Duplicate",
        summary: "Do not resend",
        status: "waiting_customer",
      }),
    /已有发送记录/,
  );
});
test("automatic acknowledgement alone never resolves or answers the customer request", async () => {
  const f = fixture(false);
  await syncSupportSources(f.env);
  assert.equal(f.store.dashboard().cases[0].status, "pending");
  assert.equal(f.store.dashboard().counts.waiting_customer, 0);
});
test("source replay preserves an owner decision and new customer mail remains pending", async () => {
  const f = fixture();
  await syncSupportSources(f.env);
  let item = f.store.dashboard().cases[0];
  item = f.store.ownerInstruction(
    item.id,
    item.version,
    "owner-import-decision",
    "Need the report URL before deletion",
  );
  await syncSupportSources(f.env);
  assert.equal(f.store.getCase(item.id).ownerInstructionPending, true);
  assert.equal(f.store.getCase(item.id).status, "pending");
  const next = f.store.registerInbound({
    mailboxId: mailbox,
    threadId: item.threadId,
    emailId: "new-inbound",
    subject: item.subject,
    sender: item.sender,
    date: new Date(Date.now() + 1000).toISOString(),
  });
  await syncSupportSources(f.env);
  assert.equal(f.store.getCase(next.id).latestEmailId, "new-inbound");
  assert.equal(f.store.getCase(next.id).status, "pending");
});
test("source outage or malformed source data is surfaced instead of silently skipping intake", async () => {
  const f = fixture();
  f.env.WBT_SUPPORT_SOURCE.fetch = async () =>
    new Response("Unavailable", { status: 503 });
  await assert.rejects(() => syncSupportSources(f.env), /503/);
  f.env.WBT_SUPPORT_SOURCE.fetch = async () =>
    Response.json({ ...f.feed, source: "untrusted-other-source" });
  await assert.rejects(() => syncSupportSources(f.env));
});

test("historical form backfill waits for review of QQ history instead of becoming a new automatic reply", async () => {
  const f = fixture(false);
  f.feed.requests[0].createdAt = Date.now() - 2 * 86400000;
  await syncSupportSources(f.env);
  const item = f.store.dashboard().cases[0];
  assert.equal(item.status, "needs_owner");
  assert.match(item.nextAction, /QQ/);
  await syncSupportSources(f.env);
  assert.equal(f.store.getCase(item.id).status, "needs_owner");
});
