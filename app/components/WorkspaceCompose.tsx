import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMailboxes } from "~/queries/mailboxes";
import { useWorkspaceDraft } from "~/hooks/useWorkspaceDraft";
import api, { ApiError } from "~/services/api";

export default function WorkspaceCompose() {
  const [params, setParams] = useSearchParams();
  const { data: mailboxes = [] } = useMailboxes();
  const dialog = useRef<HTMLDialogElement>(null);
  const open = params.get("compose") === "1";
  const [from, setFrom] = useState("");
  const requested = params.get("from") || "";
  useEffect(() => {
    if (open && mailboxes.length)
      setFrom(
        mailboxes.some((m) => m.id === requested) ? requested : mailboxes[0].id,
      );
  }, [open, requested, mailboxes]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const close = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("compose");
      n.delete("from");
      return n;
    });
  return (
    <dialog
      className="ws-compose-dialog"
      ref={dialog}
      onCancel={close}
      aria-labelledby="ws-compose-title"
    >
      <header>
        <h2 id="ws-compose-title">写邮件</h2>
        <button aria-label="关闭写邮件" className="ws-button" onClick={close}>
          关闭
        </button>
      </header>
      <label>
        发件邮箱
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.email}
            </option>
          ))}
        </select>
      </label>
      {from && <ComposeForm key={from} from={from} close={close} />}
    </dialog>
  );
}
function ComposeForm({ from, close }: { from: string; close: () => void }) {
  const client = useQueryClient();
  const [draft, save] = useWorkspaceDraft(`compose:${from}`, {
    to: "",
    subject: "",
    text: "",
    operationId: "",
    locked: false,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [caseId, setCaseId] = useState("");
  const [confirmedFailed, setConfirmedFailed] = useState(false);
  const [missingOperation, setMissingOperation] = useState(false);
  async function cancelUnsubmitted() {
    try {
      await api.cancelSupportOperation(draft.operationId);
      save({ ...draft, operationId: "", locked: false });
      setMissingOperation(false);
      setNotice("已取消未提交操作，草稿已恢复。此前的请求即使迟到也不会发送。");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "取消结果需要核对，请再次检查发送结果。",
      );
    }
  }
  async function checkResult() {
    try {
      const result = await api.getSupportOperation(draft.operationId);
      setMissingOperation(false);
      setCaseId(result.caseId);
      if (result.state === "accepted") {
        save({ to: "", subject: "", text: "", operationId: "", locked: false });
        setNotice("邮件服务已接受邮件，已清理发送草稿。");
      } else if (result.state === "failed") {
        setConfirmedFailed(true);
        setNotice("已确认上次提交失败，可恢复草稿编辑。");
      } else
        setNotice("投递结果仍需核对。请打开工单记录，确认前不要再次发送。");
    } catch (error) {
      setMissingOperation(error instanceof ApiError && error.status === 404);
      setNotice(
        error instanceof Error
          ? error.message
          : "暂时无法核对，请查看处理记录。",
      );
    }
  }
  const change = (field: "to" | "subject" | "text", value: string) =>
    save({ ...draft, [field]: value, operationId: "" });
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || draft.locked) return;
    const operationId = draft.operationId || crypto.randomUUID();
    save({ ...draft, operationId, locked: true });
    setBusy(true);
    setConfirmedFailed(false);
    setMissingOperation(false);
    setNotice("正在提交邮件，请等待投递回执…");
    try {
      const result = await api.sendSupportMail({
        from,
        operationId,
        to: draft.to,
        subject: draft.subject,
        text: draft.text,
      });
      if (result.state !== "accepted") throw new Error("投递结果待核对");
      setCaseId(result.caseId);
      save({ to: "", subject: "", text: "", operationId: "", locked: false });
      setNotice("邮件服务已接受邮件。可在处理记录中查看回执。");
      await client.invalidateQueries({ queryKey: ["support"] });
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) {
        save({ ...draft, operationId: "", locked: false });
        setNotice(error.message);
      } else {
        if (error instanceof ApiError && typeof error.body.caseId === "string")
          setCaseId(error.body.caseId);
        setNotice(
          "发送结果需要核对，草稿已保留。请先查看处理记录，确认前不要再次发送。",
        );
        await client.invalidateQueries({ queryKey: ["support"] });
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ws-form" onSubmit={send}>
      <label>
        收件人
        <input
          type="email"
          required
          value={draft.to}
          onChange={(e) => change("to", e.target.value)}
          disabled={draft.locked}
        />
      </label>
      <label>
        主题
        <input
          required
          maxLength={300}
          value={draft.subject}
          onChange={(e) => change("subject", e.target.value)}
          disabled={draft.locked}
        />
      </label>
      <label>
        正文
        <textarea
          required
          rows={9}
          maxLength={15000}
          value={draft.text}
          onChange={(e) => change("text", e.target.value)}
          disabled={draft.locked}
        />
      </label>
      <p className="ws-muted">
        草稿按发件邮箱保存在当前标签页会话中。需要附件、抄送或富文本时，可进入项目邮箱使用完整编辑器。
      </p>
      <div className="ws-form-actions">
        <button className="ws-button" type="button" onClick={close}>
          稍后继续
        </button>
        <button
          className="ws-button ws-primary"
          type="submit"
          disabled={busy || draft.locked}
        >
          {busy ? "发送中…" : "发送邮件"}
        </button>
      </div>
      {draft.locked && !busy && (
        <div className="ws-form-actions">
          <button className="ws-button" type="button" onClick={checkResult}>
            核对发送结果
          </button>
          {missingOperation && (
            <button
              className="ws-button"
              type="button"
              onClick={cancelUnsubmitted}
            >
              取消未提交操作并恢复草稿
            </button>
          )}
          {confirmedFailed && (
            <button
              className="ws-button"
              type="button"
              onClick={() => {
                save({ ...draft, operationId: "", locked: false });
                setConfirmedFailed(false);
                setNotice(
                  "草稿已恢复，请修改后重新提交。旧的失败记录仍保留在工单中。",
                );
              }}
            >
              恢复草稿编辑
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status">
          {notice}{" "}
          {caseId ? (
            <a href={`/inbox?case=${encodeURIComponent(caseId)}`}>查看邮件 →</a>
          ) : draft.locked ? (
            <a href="/records">查看处理记录 →</a>
          ) : null}
        </p>
      )}
    </form>
  );
}
