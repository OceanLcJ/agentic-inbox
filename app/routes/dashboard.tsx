import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import api from "~/services/api";
import {
  ActivityList,
  AutomationHealth,
  CaseRow,
  LoadState,
} from "~/components/SupportCommon";
import { SUPPORT_LABELS, type SupportStatus } from "../../shared/support";

export function meta() {
  return [{ title: "仪表盘 · Agentic Inbox" }];
}
export default function DashboardRoute() {
  const query = useQuery({
    queryKey: ["support", "overview"],
    queryFn: ({ signal }) => api.getSupportOverview(signal),
    refetchInterval: 30000,
  });
  const d = query.data;
  return (
    <main className="ws-screen ws-dashboard">
      <header className="ws-heading">
        <div>
          <h1>仪表盘</h1>
          <p>先处理需要你决定的事，其余进展在这里查看。</p>
        </div>
        <Link className="ws-text-link" to="/records">
          查看处理记录 <ArrowUpRightIcon size={14} />
        </Link>
      </header>
      {!d ? (
        <LoadState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <AutomationHealth automation={d.automation} />
          <div className="ws-metrics">
            {[
              {
                title: "待你决定",
                value: d.counts.needs_owner,
                note: "需要你的判断或授权",
                to: "/inbox?status=needs_owner",
                color: "owner",
              },
              {
                title: "待处理 / 处理中",
                value: d.counts.pending + d.counts.processing,
                note: `${d.counts.pending} 项等待巡检 · ${d.counts.processing} 项已接单`,
                to: "/inbox?group=work",
                color: "work",
              },
              {
                title: "等客户补充",
                value: d.waitingCount,
                note: d.followUpCount
                  ? `${d.followUpCount} 项已等待超过 24 小时`
                  : "客户回复后会重新进入队列",
                to: "/inbox?status=waiting_customer",
                color: "",
              },
              {
                title: "今日处理",
                value: d.todayTouched,
                note: `按工单去重 · 含 ${d.todayResolved} 项已解决`,
                to: "/records?period=today&scope=customer",
                color: "",
              },
            ].map((m) => (
              <Link
                key={m.title}
                className={`ws-metric ws-metric-${m.color}`}
                to={m.to}
              >
                <span>
                  {m.title}
                  <ArrowUpRightIcon size={14} />
                </span>
                <strong>
                  {m.value}
                  <small>项</small>
                </strong>
                <p>{m.note}</p>
              </Link>
            ))}
          </div>
          <div className="ws-dashboard-columns">
            <div>
              <section className="ws-dashboard-section">
                <div className="ws-section-heading">
                  <h2>
                    需要你决定 <small>{d.counts.needs_owner}</small>
                  </h2>
                  <Link to="/inbox?status=needs_owner">查看全部 →</Link>
                </div>
                {d.ownerCases.length ? (
                  d.ownerCases.map((item) => (
                    <CaseRow key={item.id} item={item} />
                  ))
                ) : (
                  <div className="ws-quiet-empty">
                    <strong>目前没有需要你决定的事项</strong>
                    <p>需要确认的方案、权限或投递异常会出现在这里。</p>
                  </div>
                )}
              </section>
              <section className="ws-dashboard-section">
                <div className="ws-section-heading">
                  <h2>自动处理进展</h2>
                  <Link to="/inbox?group=work">查看队列 →</Link>
                </div>
                {d.workingCases.length ? (
                  d.workingCases.map((item) => (
                    <CaseRow key={item.id} item={item} compact />
                  ))
                ) : (
                  <div className="ws-quiet-empty">
                    <strong>当前处理队列为空</strong>
                    <p>新来信会自动进入队列，巡检接单后更新处理进展。</p>
                  </div>
                )}
              </section>
            </div>
            <div>
              <section className="ws-dashboard-section">
                <div className="ws-section-heading">
                  <h2>工单分布</h2>
                  <span>当前状态</span>
                </div>
                <div
                  className="ws-distribution"
                  role="img"
                  aria-label="工单状态分布"
                >
                  {(
                    [
                      "needs_owner",
                      "processing",
                      "pending",
                      "waiting_customer",
                      "resolved",
                    ] as SupportStatus[]
                  ).map((s) => (
                    <span
                      key={s}
                      className={`ws-segment-${s}`}
                      style={{ flex: d.counts[s] || 0 }}
                    />
                  ))}
                </div>
                <div className="ws-distribution-legend">
                  {(
                    [
                      "needs_owner",
                      "processing",
                      "pending",
                      "waiting_customer",
                      "resolved",
                    ] as SupportStatus[]
                  ).map((s) => (
                    <Link key={s} to={`/inbox?status=${s}`}>
                      <i className={`ws-segment-${s}`} />
                      {SUPPORT_LABELS[s]}
                      <strong>{d.counts[s]}</strong>
                    </Link>
                  ))}
                </div>
              </section>
              <section className="ws-dashboard-section">
                <div className="ws-section-heading">
                  <h2>今日处理动态</h2>
                  <Link to="/records?period=today&scope=customer">全部 →</Link>
                </div>
                {d.todayEvents.length ? (
                  <ActivityList events={d.todayEvents} compact />
                ) : (
                  <div className="ws-quiet-empty">
                    <p>今天还没有客户工单处理记录。</p>
                    <Link className="ws-text-link" to="/records">
                      查看巡检记录 →
                    </Link>
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
