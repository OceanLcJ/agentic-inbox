import type {
	SupportAutomation,
	SupportCase,
	SupportDashboard,
	SupportEvent,
	SupportReply,
	SupportStatus,
	SupportUpdate,
} from "../../shared/support";
import { SUPPORT_STATUSES } from "../../shared/support";

interface SQL {
	exec(
		query: string,
		...params: (string | number | null)[]
	): { toArray(): Record<string, unknown>[] };
}
export class SupportConflict extends Error {
	constructor(message: string) {
		super(`SUPPORT_CONFLICT: ${message}`);
	}
}
export interface InboundSupport {
	mailboxId: string;
	threadId: string;
	emailId: string;
	subject: string;
	sender: string;
	date: string;
}
export interface ReplyOperation {
	id: string;
	caseId: string;
	emailId: string;
	claimId: string;
	startedAt: string;
	state: "started" | "accepted" | "uncertain" | "failed";
	text: string;
	summary: string;
	status: "waiting_customer" | "resolved";
	providerMessageId?: string;
	error?: string;
}

// Methods are synchronous so the Durable Object can commit each command atomically.
export class SupportStore {
	constructor(private sql: SQL) {
		sql.exec(
			`CREATE TABLE IF NOT EXISTS support_cases (id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, thread TEXT NOT NULL, status TEXT NOT NULL, updated TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(mailbox, thread))`,
		);
		sql.exec(
			`CREATE TABLE IF NOT EXISTS support_events (id TEXT PRIMARY KEY, case_id TEXT, created TEXT NOT NULL, data TEXT NOT NULL)`,
		);
		sql.exec(
			`CREATE INDEX IF NOT EXISTS support_events_case ON support_events(case_id, created)`,
		);
		sql.exec(
			`CREATE TABLE IF NOT EXISTS support_operations (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
		);
		sql.exec(
			`CREATE TABLE IF NOT EXISTS support_meta (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
		);
	}
	private one<T>(
		query: string,
		...params: (string | number | null)[]
	): T | undefined {
		const row = this.sql.exec(query, ...params).toArray()[0];
		return row ? (JSON.parse(String(row.data)) as T) : undefined;
	}
	getCase(id: string) {
		return this.one<SupportCase>(
			"SELECT data FROM support_cases WHERE id = ?",
			id,
		);
	}
	getEvents(id: string) {
		return this.sql
			.exec(
				"SELECT data FROM support_events WHERE case_id = ? ORDER BY created ASC, rowid ASC",
				id,
			)
			.toArray()
			.map((row) => JSON.parse(String(row.data)) as SupportEvent);
	}
	private save(item: SupportCase) {
		this.sql.exec(
			"INSERT INTO support_cases(id, mailbox, thread, status, updated, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated=excluded.updated, data=excluded.data",
			item.id,
			item.mailboxId,
			item.threadId,
			item.status,
			item.updatedAt,
			JSON.stringify(item),
		);
		return item;
	}
	private event(event: SupportEvent) {
		this.sql.exec(
			"INSERT INTO support_events(id, case_id, created, data) VALUES (?, ?, ?, ?)",
			event.id,
			event.caseId,
			event.createdAt,
			JSON.stringify(event),
		);
	}
	private checked(id: string, version: number) {
		const item = this.getCase(id);
		if (!item) throw new SupportConflict("工单不存在");
		if (item.version !== version)
			throw new SupportConflict("工单已有更新，请刷新后重试");
		return item;
	}
	registerInbound(input: InboundSupport, now = new Date().toISOString()) {
		const operationId = `inbound:${input.mailboxId}:${input.emailId}`;
		const existing = this.one<SupportCase>(
			"SELECT data FROM support_cases WHERE mailbox = ? AND thread = ?",
			input.mailboxId,
			input.threadId,
		);
		if (this.one("SELECT data FROM support_events WHERE id = ?", operationId))
			return existing!;
		if (existing && input.date < existing.latestInboundAt) return existing;
		const item: SupportCase = {
			id: existing?.id ?? crypto.randomUUID(),
			mailboxId: input.mailboxId,
			threadId: input.threadId,
			subject: input.subject,
			sender: input.sender,
			latestEmailId: input.emailId,
			latestInboundAt: input.date,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			status: existing?.delivery === "uncertain" ? "needs_owner" : "pending",
			summary:
				existing?.delivery === "uncertain"
					? "收到新来信，但上一封回复的投递结果仍待核实"
					: existing
						? "客户有新来信，等待继续处理"
						: "新来信，等待检查完整线程",
			nextAction: existing?.ownerInstructionPending ? existing.nextAction : "",
			version: (existing?.version ?? 0) + 1,
			delivery: existing?.delivery === "uncertain" ? "uncertain" : undefined,
			replyOperationId: existing?.replyOperationId,
			ownerInstructionPending: existing?.ownerInstructionPending,
		};
		this.save(item);
		this.event({
			id: operationId,
			caseId: item.id,
			createdAt: now,
			actor: "system",
			kind: "inbound",
			summary: existing ? "收到客户新回复" : "来信已进入处理队列",
		});
		return item;
	}
	updateCase(
		id: string,
		update: SupportUpdate,
		actor: SupportEvent["actor"],
		now = new Date().toISOString(),
	) {
		if (
			this.one(
				"SELECT data FROM support_events WHERE id = ?",
				update.operationId,
			)
		)
			return this.getCase(id)!;
		const item = this.checked(id, update.expectedVersion);
		if (item.delivery === "uncertain" && update.status === "processing")
			throw new SupportConflict("上次邮件投递结果待核实，不能自动重发");
		const next = {
			...item,
			status: update.status,
			summary: update.summary,
			nextAction: update.nextAction,
			updatedAt: now,
			version: item.version + 1,
			claimId: update.status === "processing" ? update.operationId : undefined,
			ownerInstructionPending:
				update.status === "processing" ? false : item.ownerInstructionPending,
		};
		this.save(next);
		this.event({
			id: update.operationId,
			caseId: id,
			createdAt: now,
			actor,
			kind: update.status === "processing" ? "claimed" : "status",
			summary: update.summary,
			evidence: update.evidence,
		});
		return next;
	}
	ownerInstruction(
		id: string,
		expectedVersion: number,
		operationId: string,
		text: string,
		now = new Date().toISOString(),
	) {
		if (this.one("SELECT data FROM support_events WHERE id = ?", operationId))
			return this.getCase(id)!;
		const item = this.checked(id, expectedVersion);
		const next = {
			...item,
			status:
				item.delivery === "uncertain"
					? ("needs_owner" as const)
					: ("pending" as const),
			summary:
				item.delivery === "uncertain"
					? "处理意见已保存，上次投递结果仍需核实"
					: "你补充了处理意见，等待下一次巡检",
			nextAction: text,
			ownerInstructionPending: true,
			version: item.version + 1,
			updatedAt: now,
			claimId: undefined,
		};
		this.save(next);
		this.event({
			id: operationId,
			caseId: id,
			createdAt: now,
			actor: "operator",
			kind: "instruction",
			summary: text,
		});
		return next;
	}
	addNote(
		id: string,
		expectedVersion: number,
		operationId: string,
		summary: string,
		evidence: string,
		actor: SupportEvent["actor"],
		now = new Date().toISOString(),
	) {
		const previous = this.one<SupportEvent>(
			"SELECT data FROM support_events WHERE id = ?",
			operationId,
		);
		if (previous) {
			if (previous.caseId !== id)
				throw new SupportConflict("操作编号已用于另一工单");
			return this.getCase(id)!;
		}
		const item = this.checked(id, expectedVersion);
		const next = this.save({
			...item,
			updatedAt: now,
			version: item.version + 1,
		});
		this.event({
			id: operationId,
			caseId: id,
			createdAt: now,
			actor,
			kind: "note",
			summary,
			evidence,
		});
		return next;
	}
	beginReply(
		id: string,
		request: SupportReply,
		now = new Date().toISOString(),
	) {
		const replay = this.one<ReplyOperation>(
			"SELECT data FROM support_operations WHERE id = ?",
			request.operationId,
		);
		if (replay) {
			if (replay.caseId !== id)
				throw new SupportConflict("操作编号已用于另一工单");
			return { operation: replay, replay: true };
		}
		const item = this.checked(id, request.expectedVersion);
		const previousSend = this.one<ReplyOperation>(
			"SELECT data FROM support_operations WHERE json_extract(data, '$.caseId') = ? AND json_extract(data, '$.emailId') = ? AND json_extract(data, '$.state') IN ('started', 'accepted', 'uncertain') LIMIT 1",
			id,
			item.latestEmailId,
		);
		if (previousSend)
			throw new SupportConflict(
				"这条来信已有发送记录，请先核对线程，不要重复回复",
			);
		if (
			item.status !== "processing" ||
			item.claimId !== request.claimId ||
			item.delivery === "uncertain"
		)
			throw new SupportConflict("请先认领工单，并核对是否已有回复");
		const operation: ReplyOperation = {
			id: request.operationId,
			caseId: id,
			emailId: item.latestEmailId,
			claimId: request.claimId,
			startedAt: now,
			state: "started",
			text: request.text,
			summary: request.summary,
			status: request.status,
		};
		this.sql.exec(
			"INSERT INTO support_operations(id, data) VALUES (?, ?)",
			operation.id,
			JSON.stringify(operation),
		);
		this.save({
			...item,
			delivery: "uncertain",
			replyOperationId: request.operationId,
			updatedAt: now,
			version: item.version + 1,
		});
		this.event({
			id: `${operation.id}:started`,
			caseId: id,
			createdAt: now,
			actor: "agent",
			kind: "reply_started",
			summary: "正在提交邮件；结果确认前不会重复发送",
		});
		return { operation, replay: false };
	}
	finishReply(
		operationId: string,
		result:
			| { providerMessageId: string }
			| { error: string; definitive: boolean },
		now = new Date().toISOString(),
	) {
		const operation = this.one<ReplyOperation>(
			"SELECT data FROM support_operations WHERE id = ?",
			operationId,
		);
		if (!operation) throw new SupportConflict("发送操作不存在");
		if (operation.state !== "started") return operation;
		const item = this.getCase(operation.caseId)!;
		const accepted = "providerMessageId" in result;
		operation.state = accepted
			? "accepted"
			: result.definitive
				? "failed"
				: "uncertain";
		if (accepted) operation.providerMessageId = result.providerMessageId;
		else operation.error = result.error;
		this.sql.exec(
			"UPDATE support_operations SET data = ? WHERE id = ?",
			JSON.stringify(operation),
			operationId,
		);
		const newerInbound = item.latestEmailId !== operation.emailId;
		const interveningDecision = item.claimId !== operation.claimId;
		const status = accepted
			? newerInbound
				? "pending"
				: item.ownerInstructionPending
					? "pending"
					: interveningDecision
						? item.status
						: operation.status
			: "needs_owner";
		const summary = accepted
			? newerInbound
				? "已回复上一条来信；还有新来信待处理"
				: item.ownerInstructionPending
					? "你补充了处理意见，等待下一次巡检"
					: interveningDecision
						? item.summary
						: operation.summary
			: `回复${operation.state === "uncertain" ? "投递结果待核实，禁止自动重发" : "未发送成功"}：${result.error}`;
		this.save({
			...item,
			status,
			summary,
			delivery: accepted
				? "accepted"
				: operation.state === "failed"
					? "failed"
					: "uncertain",
			nextAction: accepted
				? newerInbound || interveningDecision
					? item.nextAction
					: ""
				: ["核对邮件服务记录后决定下一步", item.nextAction]
						.filter(Boolean)
						.join("\n"),
			updatedAt: now,
			version: item.version + 1,
			claimId: undefined,
		});
		this.event({
			id: `${operationId}:result`,
			caseId: item.id,
			createdAt: now,
			actor: "agent",
			kind: accepted ? "reply_accepted" : "reply_failed",
			summary: accepted ? `邮件服务已接受回复。${operation.summary}` : summary,
			replyText: operation.text,
			providerMessageId: accepted ? result.providerMessageId : undefined,
		});
		return operation;
	}
	reconcileReply(
		id: string,
		expectedVersion: number,
		commandId: string,
		result: {
			outcome: "accepted" | "failed";
			evidence: string;
			providerMessageId?: string;
		},
		now = new Date().toISOString(),
	) {
		const previous = this.one<SupportEvent>(
			"SELECT data FROM support_events WHERE id = ?",
			commandId,
		);
		if (previous) {
			if (previous.caseId !== id)
				throw new SupportConflict("操作编号已用于另一工单");
			return this.getCase(id)!;
		}
		const item = this.checked(id, expectedVersion);
		const operation = item.replyOperationId
			? this.one<ReplyOperation>(
					"SELECT data FROM support_operations WHERE id = ?",
					item.replyOperationId,
				)
			: undefined;
		if (
			!operation ||
			item.delivery !== "uncertain" ||
			!["started", "uncertain"].includes(operation.state)
		)
			throw new SupportConflict("这条工单没有待核实的发送操作");
		if (
			operation.state === "started" &&
			Date.parse(now) - Date.parse(operation.startedAt) < 5 * 60000
		)
			throw new SupportConflict("邮件仍在提交，请等待本次发送结束后核对");
		if (result.outcome === "accepted" && !result.providerMessageId?.trim())
			throw new SupportConflict("请填写邮件服务的接受编号作为核对依据");
		operation.state = result.outcome;
		if (result.outcome === "accepted")
			operation.providerMessageId = result.providerMessageId;
		this.sql.exec(
			"UPDATE support_operations SET data = ? WHERE id = ?",
			JSON.stringify(operation),
			operation.id,
		);
		const newerInbound = item.latestEmailId !== operation.emailId;
		const next = this.save({
			...item,
			delivery: result.outcome,
			status:
				result.outcome === "failed" ||
				newerInbound ||
				item.ownerInstructionPending
					? "pending"
					: "waiting_customer",
			summary:
				result.outcome === "accepted"
					? "你已核实邮件服务接受了回复"
					: "你已确认上次未发送，已交回处理队列",
			nextAction:
				result.outcome === "failed"
					? "先核对已确认的失败原因是否解决，再决定是否重新回复。"
					: item.nextAction,
			version: item.version + 1,
			updatedAt: now,
			claimId: undefined,
		});
		this.event({
			id: commandId,
			caseId: id,
			createdAt: now,
			actor: "operator",
			kind: "delivery_reconciled",
			summary: next.summary,
			evidence: result.evidence,
			providerMessageId: result.providerMessageId,
		});
		return next;
	}
	automation() {
		return (
			this.one<SupportAutomation>(
				"SELECT data FROM support_meta WHERE id = 'automation'",
			) ?? { enabled: false, intervalMinutes: 60 }
		);
	}
	updateAutomation(patch: Partial<SupportAutomation>) {
		const value = { ...this.automation(), ...patch };
		this.sql.exec(
			"INSERT INTO support_meta(id, data) VALUES ('automation', ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
			JSON.stringify(value),
		);
		return value;
	}
	startRun(runId: string, now = new Date().toISOString()) {
		const state = this.automation();
		if (state.runningUntil && state.runningUntil > now)
			throw new SupportConflict("已有巡检正在运行");
		return this.updateAutomation({
			runId,
			lastRunStartedAt: now,
			runningUntil: new Date(Date.parse(now) + 90 * 60_000).toISOString(),
			lastError: "",
		});
	}
	finishRun(
		runId: string,
		summary: string,
		error = "",
		now = new Date().toISOString(),
	) {
		if (
			this.one("SELECT data FROM support_events WHERE id = ?", `run:${runId}`)
		)
			return this.automation();
		if (this.automation().runId !== runId)
			throw new SupportConflict("巡检编号不匹配");
		this.event({
			id: `run:${runId}`,
			caseId: null,
			createdAt: now,
			actor: "agent",
			kind: error ? "run_failed" : "run_finished",
			summary,
		});
		return this.updateAutomation({
			runningUntil: "",
			runId: "",
			lastRunFinishedAt: now,
			lastError: error,
		});
	}
	dashboard(
		options: {
			status?: SupportStatus;
			query?: string;
			page?: number;
			limit?: number;
		} = {},
	): SupportDashboard {
		const counts = Object.fromEntries(
			SUPPORT_STATUSES.map((status) => [status, 0]),
		) as Record<SupportStatus, number>;
		for (const row of this.sql
			.exec(
				"SELECT status, COUNT(*) AS count FROM support_cases GROUP BY status",
			)
			.toArray())
			if (typeof row.status === "string" && row.status in counts)
				counts[row.status as SupportStatus] = Number(row.count);
		const clauses: string[] = [];
		const params: (string | number)[] = [];
		if (options.status) {
			clauses.push("status = ?");
			params.push(options.status);
		}
		if (options.query?.trim()) {
			clauses.push(
				"(mailbox LIKE ? ESCAPE '\\' OR json_extract(data, '$.subject') LIKE ? ESCAPE '\\' OR json_extract(data, '$.sender') LIKE ? ESCAPE '\\')",
			);
			const pattern = `%${options.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
			params.push(pattern, pattern, pattern);
		}
		const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
		const total = Number(
			this.sql
				.exec(`SELECT COUNT(*) AS count FROM support_cases${where}`, ...params)
				.toArray()[0].count,
		);
		const limit = Math.min(50, Math.max(1, options.limit ?? 20));
		const totalPages = Math.max(1, Math.ceil(total / limit));
		const page = Math.min(totalPages, Math.max(1, options.page ?? 1));
		const cases = this.sql
			.exec(
				`SELECT data FROM support_cases${where} ORDER BY updated DESC, id LIMIT ? OFFSET ?`,
				...params,
				limit,
				(page - 1) * limit,
			)
			.toArray()
			.map((row) => JSON.parse(String(row.data)) as SupportCase);
		const recentEvents = this.sql
			.exec(
				"SELECT data FROM support_events ORDER BY created DESC, rowid DESC LIMIT 12",
			)
			.toArray()
			.map((row) => JSON.parse(String(row.data)) as SupportEvent);
		return {
			cases,
			counts,
			total,
			page,
			totalPages,
			automation: this.automation(),
			recentEvents,
		};
	}
}
