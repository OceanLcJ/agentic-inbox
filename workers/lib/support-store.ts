import type {
  SupportAutomation,
  SupportCase,
  SupportDashboard,
  SupportEvent,
  SupportReply,
  SupportStatus,
  SupportUpdate,
  SupportCompose,
  SupportOverview,
  SupportActivityPage,
  SupportActivity,
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
  actor?: "agent" | "operator";
  kind?: "reply" | "compose" | "cancelled";
  mailboxId?: string;
  to?: string;
  subject?: string;
}

export function supportDayWindow(now = new Date().toISOString()) {
  const offset = 8 * 3600000;
  const start =
    Math.floor((Date.parse(now) + offset) / 86400000) * 86400000 - offset;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86400000).toISOString(),
  };
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
  getOperation(id: string) {
    return this.one<ReplyOperation>(
      "SELECT data FROM support_operations WHERE id = ?",
      id,
    );
  }
  cancelUnsubmittedOperation(id: string, now = new Date().toISOString()) {
    const existing = this.getOperation(id);
    if (existing) {
      if (existing.state === "failed") return existing;
      throw new SupportConflict(
        "此操作已有投递记录，请先核对发送结果，不能取消",
      );
    }
    // A tombstone also rejects an original request arriving after cancellation.
    const operation: ReplyOperation = {
      id,
      caseId: "",
      emailId: "",
      claimId: "",
      startedAt: now,
      state: "failed",
      kind: "cancelled",
      actor: "operator",
      text: "",
      summary: "已取消尚未提交的邮件操作",
      status: "waiting_customer",
    };
    this.sql.exec(
      "INSERT INTO support_operations(id,data) VALUES (?,?)",
      id,
      JSON.stringify(operation),
    );
    return operation;
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
      origin: existing?.origin ?? "inbound",
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
      waitingSince:
        update.status === "waiting_customer"
          ? (item.waitingSince ?? now)
          : undefined,
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
    operator = false,
  ) {
    const replay = this.one<ReplyOperation>(
      "SELECT data FROM support_operations WHERE id = ?",
      request.operationId,
    );
    if (replay) {
      if (replay.kind === "cancelled")
        throw new SupportConflict("该发送操作已取消，请使用恢复后的草稿");
      if (replay.caseId !== id)
        throw new SupportConflict("操作编号已用于另一工单");
      if (replay.text !== request.text)
        throw new SupportConflict("发送内容已更改，请先核对上次发送结果");
      return { operation: replay, replay: true };
    }
    const item = this.checked(id, request.expectedVersion);
    const previousSend = this.one<ReplyOperation>(
      `SELECT data FROM support_operations WHERE json_extract(data, '$.caseId') = ? AND (json_extract(data, '$.state') IN ('started', 'uncertain') OR (json_extract(data, '$.emailId') = ? AND json_extract(data, '$.state') = 'accepted' AND ? = 0)) LIMIT 1`,
      id,
      item.latestEmailId,
      operator ? 1 : 0,
    );
    if (previousSend)
      throw new SupportConflict(
        "这条来信已有发送记录，请先核对线程，不要重复回复",
      );
    if (
      (!operator &&
        (item.status !== "processing" || item.claimId !== request.claimId)) ||
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
      actor: operator ? "operator" : "agent",
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
      claimId: operator ? request.claimId : item.claimId,
    });
    this.event({
      id: `${operation.id}:started`,
      caseId: id,
      createdAt: now,
      actor: operation.actor ?? "agent",
      kind: "reply_started",
      summary: "正在提交邮件；结果确认前不会重复发送",
    });
    return { operation, replay: false };
  }
  beginOutgoing(request: SupportCompose, now = new Date().toISOString()) {
    const replay = this.one<ReplyOperation>(
      "SELECT data FROM support_operations WHERE id = ?",
      request.operationId,
    );
    if (replay) {
      if (replay.kind === "cancelled")
        throw new SupportConflict("该发送操作已取消，请使用恢复后的草稿");
      if (
        replay.kind !== "compose" ||
        replay.mailboxId !== request.mailboxId ||
        replay.to !== request.to ||
        replay.subject !== request.subject ||
        replay.text !== request.text
      )
        throw new SupportConflict("发送内容已更改，请先核对上次发送结果");
      return { operation: replay, replay: true };
    }
    const caseId = crypto.randomUUID();
    const operation: ReplyOperation = {
      id: request.operationId,
      caseId,
      emailId: request.operationId,
      claimId: request.operationId,
      startedAt: now,
      state: "started",
      text: request.text,
      summary: "邮件服务已接受新邮件，等待客户回复",
      status: "waiting_customer",
      actor: "operator",
      kind: "compose",
      mailboxId: request.mailboxId,
      to: request.to,
      subject: request.subject,
    };
    this.sql.exec(
      "INSERT INTO support_operations(id, data) VALUES (?, ?)",
      operation.id,
      JSON.stringify(operation),
    );
    this.save({
      id: caseId,
      mailboxId: request.mailboxId,
      threadId: request.operationId,
      subject: request.subject,
      sender: request.to,
      latestEmailId: operation.emailId,
      latestInboundAt: "",
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: "needs_owner",
      summary: "正在提交新邮件，投递结果确认前不会重复发送",
      nextAction: "",
      delivery: "uncertain",
      replyOperationId: operation.id,
      claimId: operation.claimId,
      origin: "outbound",
    });
    this.event({
      id: `${operation.id}:started`,
      caseId,
      createdAt: now,
      actor: "operator",
      kind: "outgoing_started",
      summary: "正在提交新邮件；结果确认前不会重复发送",
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
      waitingSince: status === "waiting_customer" ? now : undefined,
    });
    this.event({
      id: `${operationId}:result`,
      caseId: item.id,
      createdAt: now,
      actor: operation.actor ?? "agent",
      kind: accepted
        ? operation.kind === "compose"
          ? "outgoing_accepted"
          : "reply_accepted"
        : "reply_failed",
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
  recordSourceIntake(
    id: string,
    reference: string,
    createdAt: string,
    source: { historical: boolean; hasReply: boolean },
  ) {
    const eventId = `source-intake:${reference}`;
    if (this.one("SELECT data FROM support_events WHERE id = ?", eventId))
      return;
    const item = this.getCase(id);
    if (source.historical && !source.hasReply && item?.version === 1) {
      this.save({
        ...item,
        status: "needs_owner",
        summary: "历史网站表单首次补录，需核对原 QQ 已有回复",
        nextAction:
          "先核对原 QQ 已发送与原站处理记录，再决定后续动作。历史请求不直接当作新来信再次答复。",
        version: item.version + 1,
      });
    }
    this.event({
      id: eventId,
      caseId: id,
      createdAt,
      actor: "system",
      kind: "source_import",
      summary: "已同步 What Brandon Thinks 网站联系表单",
      evidence: `原站工单 ${reference}。发件地址来自联系表单填写，尚未验证邮箱归属。原站自动确认与已有客服回复会一起同步；涉及账户、退款、删除的操作仍须核验并交由所有者确认。`,
    });
  }
  recordSourceReply(
    id: string,
    input: {
      id: string;
      inboundEmailId: string;
      text: string;
      providerMessageId: string | null;
      sentAt: string;
    },
  ) {
    const operationId = `source-reply:${input.id}`;
    if (this.getOperation(operationId)) return this.getCase(id);
    const item = this.getCase(id);
    if (!item) throw new SupportConflict("工单不存在");
    const operation: ReplyOperation = {
      id: operationId,
      caseId: id,
      emailId: input.inboundEmailId,
      claimId: "source-import",
      startedAt: input.sentAt,
      state: "accepted",
      text: input.text,
      summary: "原站客服回复已有发送记录",
      status: "waiting_customer",
      actor: "operator",
      kind: "reply",
      providerMessageId: input.providerMessageId ?? undefined,
    };
    this.sql.exec(
      "INSERT INTO support_operations(id,data) VALUES (?,?)",
      operationId,
      JSON.stringify(operation),
    );
    this.event({
      id: operationId,
      caseId: id,
      createdAt: input.sentAt,
      actor: "operator",
      kind: "source_reply_accepted",
      summary: "原站已发送客服回复，已同步到完整对话",
      replyText: input.text,
      providerMessageId: input.providerMessageId ?? undefined,
    });
    if (item.delivery === "uncertain") return item;
    if (item.version > 1 && input.sentAt < item.updatedAt) return item;
    const needsWork =
      item.ownerInstructionPending ||
      item.latestEmailId !== input.inboundEmailId;
    return this.save({
      ...item,
      status: needsWork ? "pending" : "waiting_customer",
      summary: needsWork
        ? "原站已回复此前请求，仍有后续事项待处理"
        : "已通过原站回复客户，等待补充",
      delivery: "accepted",
      replyOperationId: operationId,
      waitingSince: needsWork ? undefined : input.sentAt,
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
      claimId: undefined,
    });
  }
  automation() {
    return (
      this.one<SupportAutomation>(
        "SELECT data FROM support_meta WHERE id = 'automation'",
      ) ?? { enabled: false, intervalMinutes: 60 }
    );
  }
  updateAutomation(patch: Partial<SupportAutomation>) {
    const previous = this.automation();
    const value = { ...previous, ...patch };
    if (
      patch.lastScanAt &&
      previous.lastScanAt &&
      Date.parse(patch.lastScanAt) < Date.parse(previous.lastScanAt)
    ) {
      value.lastScanAt = previous.lastScanAt;
      value.lastScanError = previous.lastScanError;
    }
    if (
      patch.lastScanAt &&
      !this.one(
        "SELECT data FROM support_events WHERE id = ?",
        `scan:${patch.lastScanAt}`,
      )
    ) {
      this.event({
        id: `scan:${patch.lastScanAt}`,
        caseId: null,
        createdAt: patch.lastScanAt,
        actor: "system",
        kind: patch.lastScanError ? "scan_failed" : "scan_finished",
        summary: patch.lastScanError
          ? `邮箱巡检同步需要关注：${patch.lastScanError}`
          : "邮箱巡检同步已完成",
      });
    }
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
      group?: "work";
      hideIgnored?: boolean;
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
    if (options.group === "work")
      clauses.push("status IN ('pending', 'processing')");
    if (options.hideIgnored && options.status !== "ignored")
      clauses.push("status != 'ignored'");
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
  activity(
    options: {
      page?: number;
      limit?: number;
      period?: "today";
      kind?: string;
      scope?: "customer" | "all";
    } = {},
    now = new Date().toISOString(),
  ): SupportActivityPage {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.scope !== "all")
      clauses.push("(c.status IS NULL OR c.status != 'ignored')");
    if (options.scope === "customer")
      clauses.push(
        "c.id IS NOT NULL AND json_extract(e.data, '$.actor') != 'system'",
      );
    if (options.period === "today") {
      const day = supportDayWindow(now);
      clauses.push("e.created >= ? AND e.created < ?");
      params.push(day.start, day.end);
    }
    if (options.kind) {
      clauses.push("json_extract(e.data, '$.kind') = ?");
      params.push(options.kind);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const join =
      " FROM support_events e LEFT JOIN support_cases c ON c.id = e.case_id";
    const total = Number(
      this.sql
        .exec(`SELECT COUNT(*) AS count${join}${where}`, ...params)
        .toArray()[0].count,
    );
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, Math.max(1, options.page ?? 1));
    const events = this.sql
      .exec(
        `SELECT e.data AS data, c.data AS case_data${join}${where} ORDER BY e.created DESC, e.rowid DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        (page - 1) * limit,
      )
      .toArray()
      .map((row) => {
        const event = JSON.parse(String(row.data)) as SupportActivity;
        const item = row.case_data
          ? (JSON.parse(String(row.case_data)) as SupportCase)
          : undefined;
        return {
          ...event,
          caseSubject: item?.subject,
          mailboxId: item?.mailboxId,
          caseStatus: item?.status,
        };
      });
    return { events, total, page, totalPages };
  }
  overview(now = new Date().toISOString()): SupportOverview {
    const owner = this.dashboard({ status: "needs_owner", limit: 2 });
    const working = this.dashboard({ group: "work", limit: 2 });
    const day = supportDayWindow(now);
    const todayRows = this.sql
      .exec(
        `SELECT DISTINCT c.id, c.status FROM support_events e JOIN support_cases c ON c.id = e.case_id WHERE e.created >= ? AND e.created < ? AND c.status != 'ignored' AND json_extract(e.data, '$.actor') != 'system'`,
        day.start,
        day.end,
      )
      .toArray();
    const waiting = this.sql
      .exec("SELECT data FROM support_cases WHERE status = 'waiting_customer'")
      .toArray()
      .map((row) => JSON.parse(String(row.data)) as SupportCase);
    return {
      counts: owner.counts,
      ownerCases: owner.cases,
      workingCases: working.cases,
      waitingCount: waiting.length,
      followUpCount: waiting.filter(
        (c) =>
          Date.parse(c.waitingSince ?? c.updatedAt) <
          Date.parse(now) - 86400000,
      ).length,
      todayTouched: todayRows.length,
      todayResolved: todayRows.filter((row) => row.status === "resolved")
        .length,
      todayEvents: this.activity(
        { period: "today", scope: "customer", limit: 3 },
        now,
      ).events,
      automation: this.automation(),
    };
  }
}
