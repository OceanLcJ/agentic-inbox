import { z } from "zod";
import type { Env } from "../types";
import { supportDesk } from "./support-client";
import { Folders } from "../../shared/folders";
import { textToHtml } from "./email-helpers";

const sentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["support_acknowledgement", "support_reply"]),
  subject: z.string().max(1000),
  text: z.string().max(30000),
  html: z.string().max(100000),
  sentAt: z.number().positive(),
  providerMessageId: z.string().nullable(),
});
const feedSchema = z.object({
  source: z.literal("what-brandon-thinks:contact-form:v1"),
  requests: z
    .array(
      z.object({
        requestId: z.string().uuid(),
        createdAt: z.number().positive(),
        expiresAt: z.number().positive(),
        customerEmail: z.string().email(),
        subject: z.string().max(1000),
        text: z.string().max(30000),
        html: z.string().max(100000),
        sent: z.array(sentSchema).max(100),
      }),
    )
    .max(50),
  errors: z.array(z.string()).max(50),
  nextCursor: z.string().nullable(),
});
const mailboxId = "support@whatbrandonthinks.net";
const messageId = (value: string | null) =>
  value?.replace(/^<|>$/g, "") || null;

// This reads the private business-source binding, not the personal QQ inbox.
export async function syncSupportSources(env: Env) {
  if (!env.WBT_SUPPORT_SOURCE)
    throw new Error("What Brandon Thinks 表单同步源未配置");
  const startAt = Date.parse(env.WBT_SUPPORT_SYNC_START_AT);
  if (!Number.isFinite(startAt))
    throw new Error("What Brandon Thinks 表单接入时间未配置");
  const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
  const desk = supportDesk(env);
  await stub.getFolders();
  let cursor: string | null = null;
  let imported = 0;
  const errors: string[] = [];
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://support-source.internal/requests");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await env.WBT_SUPPORT_SOURCE.fetch(new Request(url));
    if (!response.ok)
      throw new Error(`What Brandon Thinks 表单同步失败（${response.status}）`);
    const feed = feedSchema.parse(await response.json());
    errors.push(
      ...feed.errors.map((id) => `What Brandon Thinks 表单 ${id} 暂时无法读取`),
    );
    for (const request of feed.requests) {
      if (request.expiresAt <= Date.now()) continue;
      const emailId = `wbt-form:${request.requestId}`;
      const date = new Date(request.createdAt).toISOString();
      const ack = request.sent.find(
        (s) => s.kind === "support_acknowledgement",
      );
      await stub.importSupportEmail(Folders.INBOX, {
        id: emailId,
        thread_id: emailId,
        message_id: `form-${request.requestId}@whatbrandonthinks.net`,
        subject: request.subject,
        sender: request.customerEmail,
        recipient: mailboxId,
        date,
        body: request.html || textToHtml(request.text),
        email_references: ack?.providerMessageId
          ? JSON.stringify([messageId(ack.providerMessageId)])
          : null,
        raw_headers: JSON.stringify([
          {
            key: "X-Portfolio-Source",
            value: "what-brandon-thinks-contact-form",
          },
          { key: "X-Support-Request-Id", value: request.requestId },
        ]),
      });
      const item = await desk.registerInbound({
        mailboxId,
        threadId: emailId,
        emailId,
        subject: request.subject,
        sender: request.customerEmail,
        date,
      });
      await desk.recordSourceIntake(item.id, request.requestId, date, {
        historical: request.createdAt < startAt,
        hasReply: request.sent.some((s) => s.kind === "support_reply"),
      });
      for (const sent of request.sent) {
        const sourceEmailId = `wbt-outbox:${sent.id}`;
        const providerMessageId = messageId(sent.providerMessageId);
        await stub.importSupportEmail(Folders.SENT, {
          id: sourceEmailId,
          thread_id: emailId,
          message_id: providerMessageId,
          subject: sent.subject,
          sender: mailboxId,
          recipient: request.customerEmail,
          date: new Date(sent.sentAt).toISOString(),
          body: sent.html || textToHtml(sent.text),
          in_reply_to: `form-${request.requestId}@whatbrandonthinks.net`,
        });
        if (sent.kind === "support_reply")
          await desk.recordSourceReply(item.id, {
            id: sourceEmailId,
            inboundEmailId: emailId,
            text: sent.text,
            providerMessageId,
            sentAt: new Date(sent.sentAt).toISOString(),
          });
      }
      imported++;
    }
    if (!feed.nextCursor) return { imported, errors };
    if (feed.nextCursor === cursor)
      throw new Error("What Brandon Thinks 表单游标没有前进");
    cursor = feed.nextCursor;
  }
  errors.push("What Brandon Thinks 表单超过本轮 1000 条同步上限");
  return { imported, errors };
}
