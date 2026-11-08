import { Link } from "react-router";
import type {
  SupportActivity,
  SupportAutomation,
  SupportCase,
} from "../../shared/support";
import { SUPPORT_LABELS } from "../../shared/support";

export const supportDate = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "尚无记录";
export const actorLabel = { system: "系统", agent: "Codex", operator: "你" };
export function StatusBadge({ item }: { item: SupportCase }) {
  return (
    <span className={`ws-badge ws-${item.status}`}>
      {SUPPORT_LABELS[item.status]}
    </span>
  );
}
export function CaseRow({
  item,
  to,
  compact = false,
}: {
  item: SupportCase;
  to?: string;
  compact?: boolean;
}) {
  return (
    <Link
      className={`ws-case-row ${compact ? "ws-case-compact" : ""}`}
      to={to ?? `/inbox?case=${encodeURIComponent(item.id)}`}
    >
      <span className="ws-project-mark" aria-hidden="true">
        {item.mailboxId.split("@")[1].slice(0, 2).toUpperCase()}
      </span>
      <div className="ws-case-copy">
        <strong>{item.subject || "（无主题）"}</strong>
        {!compact && <p>{item.summary}</p>}
        <small>
          {item.mailboxId.split("@")[1]} · {supportDate(item.updatedAt)}
        </small>
      </div>
      <StatusBadge item={item} />
    </Link>
  );
}
export function ActivityList({
  events,
  compact = false,
}: {
  events: SupportActivity[];
  compact?: boolean;
}) {
  return (
    <ol className="ws-activity">
      {events.map((e) => (
        <li key={e.id}>
          <time dateTime={e.createdAt}>
            {compact
              ? supportDate(e.createdAt).split(" ").at(-1)
              : supportDate(e.createdAt)}
          </time>
          <div>
            {e.caseId ? (
              <Link to={`/inbox?case=${encodeURIComponent(e.caseId)}`}>
                {e.summary}
              </Link>
            ) : (
              <p>{e.summary}</p>
            )}
            <small>
              {actorLabel[e.actor]}
              {e.mailboxId ? ` · ${e.mailboxId.split("@")[1]}` : ""}
              {!compact && e.caseSubject ? ` · ${e.caseSubject}` : ""}
            </small>
            {!compact && e.evidence && (
              <details>
                <summary>核查依据</summary>
                <p className="ws-pre">{e.evidence}</p>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function AutomationHealth({
  automation: a,
}: {
  automation: SupportAutomation;
}) {
  const lastCheckAt = [a.lastScanAt, a.lastRunFinishedAt]
    .filter(
      (value): value is string => !!value && Number.isFinite(Date.parse(value)),
    )
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const stale =
    a.enabled &&
    (!lastCheckAt || Date.now() - Date.parse(lastCheckAt) > 2 * 3600000);
  const error = a.lastError || a.lastScanError;
  return (
    <details
      className={`ws-health ${error || stale || !a.enabled ? "ws-health-warning" : ""}`}
    >
      <summary>
        <span className="ws-health-dot" />
        {!a.enabled
          ? "自动巡检未启用"
          : error
            ? "巡检需要关注"
            : stale
              ? "巡检记录待更新"
              : "每小时自动巡检"}
        <span>上次检查 {supportDate(lastCheckAt)}</span>
      </summary>
      <div>
        <p>最近同步：{supportDate(a.lastScanAt)}</p>
        <p>最近开始：{supportDate(a.lastRunStartedAt)}</p>
        <p>最近完成：{supportDate(a.lastRunFinishedAt)}</p>
        <p>{error || "详细处理结果可在处理记录中查看。"}</p>
        <p>
          巡检依赖运行中的电脑与 Orca。未收到新来信时，仪表盘会保留真实的零值。
        </p>
      </div>
    </details>
  );
}
export function LoadState({
  error,
  retry,
}: {
  error?: unknown;
  retry?: () => void;
}) {
  return (
    <div className="ws-empty" role={error ? "alert" : "status"}>
      <strong>{error ? "暂时无法加载" : "正在加载…"}</strong>
      {!!error && (
        <>
          <p>
            {error instanceof Error ? error.message : "请检查网络和登录状态。"}
          </p>
          <button className="ws-button" onClick={retry}>
            重试
          </button>
        </>
      )}
    </div>
  );
}
