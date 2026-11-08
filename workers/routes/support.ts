import { Hono, type Context } from "hono";
import { decodeJwt } from "jose";
import { z } from "zod";
import {
	SupportReplySchema,
	SupportUpdateSchema,
	SUPPORT_STATUSES,
} from "../../shared/support";
import { supportDesk } from "../lib/support-client";
import type { Env } from "../types";
import {
	listMailboxes,
	buildReferencesChain,
	buildThreadingHeaders,
	buildQuotedReplyBlock,
	generateMessageId,
	textToHtml,
} from "../lib/email-helpers";
import { sendEmail } from "../email-sender";
import type { InboundSupport } from "../lib/support-store";
import type { EmailFull } from "../lib/schemas";
import { Folders } from "../../shared/folders";

const supportApp = new Hono<{ Bindings: Env }>();
function actor(c: Context) {
	if (c.req.header("x-support-actor") === "agent") return "agent" as const;
	const token = c.req.header("cf-access-jwt-assertion");
	return !token || typeof decodeJwt(token).email === "string"
		? ("operator" as const)
		: ("agent" as const);
}
supportApp.onError((error, c) => {
	if (error instanceof z.ZodError)
		return c.json({ error: "请求格式不正确", details: error.flatten() }, 400);
	const conflict = error.message.includes("SUPPORT_CONFLICT:");
	console.error("Support operation failed:", error.message);
	return c.json(
		{
			error: conflict
				? error.message.split("SUPPORT_CONFLICT:").at(-1)?.trim()
				: "处理台暂时无法完成操作，请重试",
		},
		conflict ? 409 : 500,
	);
});
const integer = (value: string | undefined, fallback: number, max: number) => {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0
		? Math.min(max, parsed)
		: fallback;
};
supportApp.get("/dashboard", async (c) => {
	const status = z
		.enum(SUPPORT_STATUSES)
		.optional()
		.parse(c.req.query("status"));
	return c.json(
		await supportDesk(c.env).dashboard({
			status,
			query: c.req.query("query")?.slice(0, 200),
			page: integer(c.req.query("page"), 1, 100000),
			limit: integer(c.req.query("limit"), 20, 50),
		}),
	);
});
supportApp.get("/cases/:id", async (c) => {
	const result = await supportDesk(c.env).getCaseRecord(c.req.param("id"));
	return result ? c.json(result) : c.json({ error: "工单不存在" }, 404);
});
supportApp.post("/scan", async (c) => {
	const mailboxes = await listMailboxes(c.env.BUCKET);
	const errors: string[] = [];
	let scanned = 0;
	let imported = 0;
	// Bound concurrency and backfill pages; live inbound events register immediately.
	for (let offset = 0; offset < mailboxes.length; offset += 4) {
		await Promise.all(
			mailboxes.slice(offset, offset + 4).map(async (mailbox) => {
				try {
					const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailbox.id));
					const latest = new Map<string, InboundSupport>();
					let page = 1;
					for (; page <= 10; page++) {
						const emails = await stub.getEmails({
							folder: Folders.INBOX,
							page,
							limit: 100,
							sortColumn: "date",
							sortDirection: "DESC",
						});
						for (const email of emails) {
							const threadId = email.thread_id || email.id;
							if (!latest.has(threadId))
								latest.set(threadId, {
									mailboxId: mailbox.id,
									threadId,
									emailId: email.id,
									subject: email.subject || "",
									sender: email.sender || "",
									date: email.date || new Date().toISOString(),
								});
						}
						if (emails.length < 100) break;
					}
					if (page > 10)
						errors.push(
							`${mailbox.email}：超过本次历史同步上限，较旧邮件需要另行核对`,
						);
					if (latest.size) {
						await supportDesk(c.env).syncInbound([...latest.values()]);
						imported += latest.size;
					}
					scanned++;
				} catch {
					errors.push(`${mailbox.email}：同步失败，下一次巡检重试`);
				}
			}),
		);
	}
	const now = new Date().toISOString();
	await supportDesk(c.env).updateAutomation({
		lastScanAt: now,
		lastScanError: errors.join("；"),
	});
	return c.json({
		scanned,
		mailboxes: mailboxes.length,
		importedThreads: imported,
		errors,
		scannedAt: now,
	});
});
supportApp.post("/cases/:id/update", async (c) =>
	c.json(
		await supportDesk(c.env).updateCase(
			c.req.param("id"),
			SupportUpdateSchema.parse(await c.req.json()),
			actor(c),
		),
	),
);
const noteSchema = z.object({
	expectedVersion: z.number().int().positive(),
	operationId: z.string().min(8).max(180),
	summary: z.string().trim().min(1).max(5000),
	evidence: z.string().max(6000).default(""),
});
supportApp.post("/cases/:id/note", async (c) => {
	const body = noteSchema.parse(await c.req.json());
	return c.json(
		await supportDesk(c.env).addNote(
			c.req.param("id"),
			body.expectedVersion,
			body.operationId,
			body.summary,
			body.evidence,
			actor(c),
		),
	);
});
supportApp.post("/cases/:id/instructions", async (c) => {
	if (actor(c) !== "operator")
		return c.json({ error: "只有邮箱所有者可以提交处理意见" }, 403);
	const body = noteSchema.parse(await c.req.json());
	return c.json(
		await supportDesk(c.env).ownerInstruction(
			c.req.param("id"),
			body.expectedVersion,
			body.operationId,
			body.summary,
		),
	);
});
supportApp.put("/automation", async (c) => {
	const body = z
		.object({
			enabled: z.boolean(),
			intervalMinutes: z.literal(60),
			schedulerId: z.string().max(180).optional(),
		})
		.parse(await c.req.json());
	return c.json(await supportDesk(c.env).updateAutomation(body));
});
supportApp.post("/cases/:id/reconcile", async (c) => {
	if (actor(c) !== "operator")
		return c.json({ error: "投递核对必须由邮箱所有者确认" }, 403);
	const body = z
		.object({
			expectedVersion: z.number().int().positive(),
			operationId: z.string().min(8).max(180),
			outcome: z.enum(["accepted", "failed"]),
			evidence: z.string().trim().min(5).max(5000),
			providerMessageId: z.string().trim().max(500).optional(),
		})
		.parse(await c.req.json());
	return c.json(
		await supportDesk(c.env).reconcileReply(
			c.req.param("id"),
			body.expectedVersion,
			body.operationId,
			{
				outcome: body.outcome,
				evidence: body.evidence,
				providerMessageId: body.providerMessageId,
			},
		),
	);
});
supportApp.post("/runs/start", async (c) => {
	const { runId } = z
		.object({ runId: z.string().min(8).max(180) })
		.parse(await c.req.json());
	return c.json(await supportDesk(c.env).startRun(runId));
});
supportApp.post("/runs/finish", async (c) => {
	const body = z
		.object({
			runId: z.string().min(8).max(180),
			summary: z.string().min(1).max(4000),
			error: z.string().max(3000).default(""),
		})
		.parse(await c.req.json());
	return c.json(
		await supportDesk(c.env).finishRun(body.runId, body.summary, body.error),
	);
});
supportApp.post("/cases/:id/reply", async (c) => {
	const request = SupportReplySchema.parse(await c.req.json());
	const desk = supportDesk(c.env);
	const id = c.req.param("id");
	const { operation, replay } = await desk.beginReply(id, request);
	if (replay)
		return c.json(operation, operation.state === "accepted" ? 200 : 409);
	const record = await desk.getCaseRecord(id);
	if (!record) throw new Error("Claimed case disappeared");
	const mailboxId = record.case.mailboxId;
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailboxId));
	let original: EmailFull;
	let receipt: { messageId: string };
	try {
		const found = await stub.getEmail(operation.emailId);
		if (!found)
			throw Object.assign(new Error("原邮件不存在"), { definitive: true });
		original = found as EmailFull;
		const to = z.string().email().safeParse(original.sender);
		if (
			!to.success ||
			original.sender.toLowerCase() === mailboxId.toLowerCase()
		)
			throw Object.assign(new Error("收件地址需要人工核对"), {
				definitive: true,
			});
		const rateLimitError = await (
			stub as unknown as { checkSendRateLimit(): Promise<string | null> }
		).checkSendRateLimit();
		if (rateLimitError)
			throw Object.assign(new Error(rateLimitError), { definitive: true });
		const { originalMsgId, references } = buildReferencesChain(original);
		const html =
			textToHtml(request.text) +
			buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender,
				body: original.body ?? undefined,
			});
		receipt = await sendEmail(c.env.EMAIL, {
			to: to.data,
			from: mailboxId,
			subject: /^re:/i.test(original.subject)
				? original.subject
				: `Re: ${original.subject}`,
			html,
			text: request.text,
			headers: {
				...buildThreadingHeaders(originalMsgId, references),
				"X-Portfolio-Operation-Id": request.operationId,
			},
		});
	} catch (error) {
		const value = error as Error & { code?: string; definitive?: boolean };
		const definitive =
			value.definitive ||
			[
				"E_VALIDATION_ERROR",
				"E_FIELD_MISSING",
				"E_SENDER_NOT_VERIFIED",
				"E_RECIPIENT_NOT_ALLOWED",
				"E_RECIPIENT_SUPPRESSED",
				"E_ACCOUNT_SUSPENDED",
				"E_SENDER_DOMAIN_NOT_AVAILABLE",
				"E_RATE_LIMIT_EXCEEDED",
				"E_DAILY_LIMIT_EXCEEDED",
			].includes(value.code ?? "");
		return c.json(
			await desk.finishReply(request.operationId, {
				error: value.message,
				definitive: Boolean(definitive),
			}),
			502,
		);
	}
	// Record provider acceptance before touching the mailbox so an interrupted response cannot cause a second send.
	const completed = await desk.finishReply(request.operationId, {
		providerMessageId: receipt.messageId,
	});
	try {
		const { originalMsgId, references, threadId } = buildReferencesChain(
			original!,
		);
		const { messageId, outgoingMessageId } = generateMessageId(
			mailboxId.split("@")[1],
		);
		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject: /^re:/i.test(original!.subject)
					? original!.subject
					: `Re: ${original!.subject}`,
				sender: mailboxId,
				recipient: original!.sender,
				cc: null,
				bcc: null,
				date: new Date().toISOString(),
				body: textToHtml(request.text),
				in_reply_to: originalMsgId,
				email_references: JSON.stringify(references),
				thread_id: threadId,
				message_id: outgoingMessageId,
			},
			[],
		);
	} catch (error) {
		console.error(
			"Support reply accepted, Sent copy failed:",
			(error as Error).message,
		);
	}
	return c.json(completed);
});

export { supportApp };
