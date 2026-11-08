import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  SUPPORT_LABELS,
  type SupportCase,
  type SupportEvent,
} from "../../shared/support";
import api, { ApiError } from "~/services/api";
import { useWorkspaceDraft } from "~/hooks/useWorkspaceDraft";
import {
  actorLabel,
  LoadState,
  StatusBadge,
  supportDate,
} from "./SupportCommon";
import SupportMessageBody from "./SupportMessageBody";

export default function SupportCaseDetail({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState("conversation");
  const query = useQuery({
    queryKey: ["support", "case", id],
    queryFn: ({ signal }) => api.getSupportCase(id, signal),
    refetchInterval: 15000,
  });
  const item = query.data?.case;
  const events = query.data?.events || [];
  useEffect(() => {
    heading.current?.focus();
  }, [id, !!item]);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["support"] });
    client.invalidateQueries({ queryKey: ["support-thread", id] });
  };
  return (
    <aside className="ws-detail" aria-label="工单详情">
      <button className="ws-detail-back" onClick={close}>
        ← 返回来信列表
      </button>
      {!item ? (
        <LoadState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <header className="ws-detail-heading">
            <div className="ws-section-heading">
              <StatusBadge item={item} />
              <button
                className="ws-button"
                aria-label="关闭工单详情"
                onClick={close}
              >
                关闭
              </button>
            </div>
            <h2 tabIndex={-1} ref={heading}>
              {item.subject || "（无主题）"}
            </h2>
            <p>{item.sender}</p>
            <p>项目邮箱：{item.mailboxId}</p>
            <small>更新于 {supportDate(item.updatedAt)}</small>
          </header>
          <div
            className="ws-detail-tabs"
            role="tablist"
            aria-label="工单视图"
            onKeyDown={(e) => {
              const keys = ["conversation", "decision", "timeline"];
              const i = keys.indexOf(tab);
              const next =
                e.key === "ArrowRight"
                  ? keys[(i + 1) % 3]
                  : e.key === "ArrowLeft"
                    ? keys[(i + 2) % 3]
                    : e.key === "Home"
                      ? keys[0]
                      : e.key === "End"
                        ? keys[2]
                        : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {[
              ["conversation", "完整对话"],
              ["decision", "处理依据"],
              ["timeline", "时间线"],
            ].map(([key, label]) => (
              <button
                id={`tab-${key}`}
                key={key}
                role="tab"
                tabIndex={tab === key ? 0 : -1}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="ws-detail-body"
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "conversation" && (
              <>
                {item.status === "waiting_customer" &&
                  Date.now() - Date.parse(item.waitingSince || item.updatedAt) >
                    86400000 && (
                    <p className="ws-muted">
                      客户已超过 24 小时未补充，可核查是否需要跟进。
                    </p>
                  )}
                <Conversation item={item} events={events} />
                <ReplyForm key={`${id}:reply`} item={item} refresh={refresh} />
              </>
            )}
            {tab === "decision" && (
              <>
                <h3>当前判断</h3>
                <p className="ws-pre">{item.summary}</p>
                <h3>下一步</h3>
                <p className="ws-pre">
                  {item.nextAction ||
                    (item.status === "waiting_customer"
                      ? "等待客户回复；新来信会重新进入队列。"
                      : "尚未记录下一步，等待核查后补充。")}
                </p>
                <h3>已记录的核查依据</h3>
                {events.filter((e) => e.evidence).length ? (
                  events
                    .filter((e) => e.evidence)
                    .map((e) => (
                      <div className="ws-evidence" key={e.id}>
                        <small>
                          {actorLabel[e.actor]} · {supportDate(e.createdAt)}
                        </small>
                        <p className="ws-pre">{e.evidence}</p>
                      </div>
                    ))
                ) : (
                  <p className="ws-muted">
                    尚无核查证据记录。订单、付款及账户归属需要从相应业务记录核实。
                  </p>
                )}
                <InstructionForm
                  key={`${id}:instruction`}
                  item={item}
                  refresh={refresh}
                />
              </>
            )}
            {tab === "timeline" && (
              <ol className="ws-timeline">
                {events.map((e) => (
                  <li key={e.id}>
                    <small>
                      {actorLabel[e.actor]} · {supportDate(e.createdAt)}
                    </small>
                    <p className="ws-pre">{e.summary}</p>
                    {e.evidence && (
                      <details>
                        <summary>核查依据</summary>
                        <p className="ws-pre">{e.evidence}</p>
                      </details>
                    )}
                    {e.replyText && (
                      <details>
                        <summary>回复正文</summary>
                        <p className="ws-pre">{e.replyText}</p>
                      </details>
                    )}
                    {e.providerMessageId && (
                      <p className="ws-receipt">
                        邮件服务接受编号：{e.providerMessageId}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {item.delivery === "uncertain" && (
              <Reconciliation item={item} refresh={refresh} />
            )}
            <Link
              className="ws-text-link ws-original-link"
              to={`/mailbox/${encodeURIComponent(item.mailboxId)}/emails/${item.origin === "outbound" && !item.latestInboundAt ? "sent" : "inbox"}?email=${encodeURIComponent(item.latestEmailId)}`}
            >
              在项目邮箱打开 →
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}
function Conversation({
  item,
  events,
}: {
  item: SupportCase;
  events: SupportEvent[];
}) {
  const query = useQuery({
    queryKey: ["support-thread", item.id, item.version],
    queryFn: async ({ signal }) => {
      const messages = await api.getThread(item.mailboxId, item.threadId, {
        signal,
      });
      return Promise.all(
        messages.map((m) =>
          m.body != null ? m : api.getEmail(item.mailboxId, m.id, { signal }),
        ),
      );
    },
    refetchInterval: 30000,
  });
  if (!query.data)
    return <LoadState error={query.error} retry={() => query.refetch()} />;
  const messages = query.data
    .filter((m) => m.folder_id !== "draft")
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const accepted = events.filter(
    (e) =>
      (e.kind === "reply_accepted" || e.kind === "outgoing_accepted") &&
      e.replyText &&
      !messages.some((m) => m.message_id === e.providerMessageId),
  );
  const rows = [
    ...messages.map((m) => ({
      id: m.id,
      date: m.date,
      sender: m.sender,
      html: m.body,
      text: "",
      attachments: m.attachments,
      emailId: m.id,
    })),
    ...accepted.map((e) => ({
      id: e.id,
      date: e.createdAt,
      sender: item.mailboxId,
      html: null,
      text: e.replyText,
      attachments: undefined,
      emailId: "",
    })),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return (
    <div className="ws-conversation">
      {rows.length ? (
        rows.map((m) => (
          <article className="ws-message" key={m.id}>
            <header>
              <strong>
                {m.sender === item.mailboxId
                  ? "发自 " + item.mailboxId
                  : m.sender}
              </strong>
              <time>{supportDate(m.date)}</time>
            </header>
            {m.html ? (
              <SupportMessageBody body={m.html} />
            ) : (
              <p className="ws-pre">
                {m.text || "邮件正文暂不可用。请在项目邮箱核对原信。"}
              </p>
            )}
            {m.attachments?.length ? (
              <ul className="ws-attachments">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <a
                      href={`/api/v1/mailboxes/${encodeURIComponent(item.mailboxId)}/emails/${encodeURIComponent(m.emailId)}/attachments/${encodeURIComponent(a.id)}`}
                      download={a.filename}
                    >
                      {a.filename}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))
      ) : (
        <p className="ws-muted">未读取到线程邮件，请在项目邮箱核对原信。</p>
      )}
    </div>
  );
}
function ReplyForm({
  item,
  refresh,
}: {
  item: SupportCase;
  refresh: () => void;
}) {
  const [draft, save] = useWorkspaceDraft(`reply:${item.id}`, {
    text: "",
    operationId: "",
    locked: false,
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || draft.locked) return;
    const operationId = draft.operationId || crypto.randomUUID();
    save({ ...draft, operationId, locked: true });
    setBusy(true);
    setNotice("正在提交回复…");
    try {
      const result = await api.replySupport(item, operationId, draft.text);
      if (result.state !== "accepted") throw new Error("投递待核实");
      save({ text: "", operationId: "", locked: false });
      setNotice("邮件服务已接受回复，等待客户补充。");
      refresh();
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) {
        save({ ...draft, operationId: "", locked: false });
        setNotice(error.message);
      } else if (
        error instanceof ApiError &&
        error.status === 409 &&
        !error.body.state
      ) {
        save({ ...draft, operationId: "", locked: false });
        setNotice(error.message);
        refresh();
      } else {
        setNotice(
          "发送结果需要核对，草稿已保留。请查看时间线与投递状态，确认前不要重复发送。",
        );
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const blocked = item.delivery === "uncertain";
  return (
    <form className="ws-form ws-reply" onSubmit={send}>
      <h3>回复客户</h3>
      <p className="ws-muted">
        从 {item.mailboxId} 回复给 {item.sender}
      </p>
      <label>
        回复正文
        <textarea
          rows={5}
          required
          maxLength={15000}
          value={draft.text}
          onChange={(e) =>
            save({ ...draft, text: e.target.value, operationId: "" })
          }
          disabled={busy || draft.locked || blocked}
        />
      </label>
      <div className="ws-form-actions">
        <span className="ws-muted">草稿按工单保留</span>
        <button
          className="ws-button ws-primary"
          disabled={busy || draft.locked || blocked || !draft.text.trim()}
        >
          {busy ? "发送中…" : "发送回复"}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {blocked && (
        <p role="alert">上次投递结果待核实，请先完成下方投递核对。</p>
      )}
      {draft.locked && !busy && !blocked && (
        <details>
          <summary>核对后恢复草稿</summary>
          <p>先确认时间线中的发送结果；已发送的内容不要再次发送。</p>
          <button
            className="ws-button"
            type="button"
            onClick={() => {
              save({ ...draft, operationId: "", locked: false });
              setNotice("已保留原文，请修改后再发送。");
            }}
          >
            已核对，恢复编辑
          </button>
        </details>
      )}
    </form>
  );
}
function InstructionForm({
  item,
  refresh,
}: {
  item: SupportCase;
  refresh: () => void;
}) {
  const [text, save] = useWorkspaceDraft(`instruction:${item.id}`, "");
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.supportInstruction(item, text),
    onSuccess: () => {
      save("");
      setNotice("处理意见已提交，等待下一次巡检接单。");
      refresh();
    },
    onError: (e) => {
      setNotice(e.message);
      refresh();
    },
  });
  return (
    <form
      className="ws-form ws-reply"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h3>给 Codex 的处理意见</h3>
      <label>
        你希望怎样继续
        <textarea
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(e) => save(e.target.value)}
          placeholder="补充核查方向、需要确认的方案或处理决定…"
          required
        />
      </label>
      <button
        className="ws-button ws-primary"
        disabled={mutation.isPending || !text.trim()}
      >
        {mutation.isPending ? "提交中…" : "提交处理意见"}
      </button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
function Reconciliation({
  item,
  refresh,
}: {
  item: SupportCase;
  refresh: () => void;
}) {
  const [outcome, setOutcome] = useState<"accepted" | "failed">("failed");
  const [evidence, setEvidence] = useState("");
  const [receipt, setReceipt] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.reconcileSupport(item, {
        outcome,
        evidence,
        providerMessageId: receipt || undefined,
      }),
    onSuccess: () => {
      setNotice("投递核对已记录。");
      refresh();
    },
    onError: (e) => setNotice(e.message),
  });
  return (
    <details className="ws-reconciliation">
      <summary>投递核对 · 需要你确认</summary>
      <form
        className="ws-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <p>
          核对邮件服务日志后记录结果。此操作不会发送邮件；提交中的邮件需等待至少
          5 分钟。
        </p>
        <label>
          核对结果
          <select
            value={outcome}
            onChange={(e) =>
              setOutcome(e.target.value as "accepted" | "failed")
            }
          >
            <option value="failed">确认未被邮件服务接受</option>
            <option value="accepted">确认已被邮件服务接受</option>
          </select>
        </label>
        {outcome === "accepted" && (
          <label>
            邮件服务接受编号
            <input
              required
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
            />
          </label>
        )}
        <label>
          核对依据
          <textarea
            minLength={5}
            maxLength={5000}
            required
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        <button className="ws-button" disabled={mutation.isPending}>
          记录核对结果
        </button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </details>
  );
}
