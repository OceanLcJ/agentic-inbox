import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import api from "~/services/api";
import {
  SUPPORT_LABELS,
  SUPPORT_STATUSES,
  type SupportStatus,
} from "../../shared/support";
import { CaseRow, LoadState } from "~/components/SupportCommon";
import SupportCaseDetail from "~/components/SupportCaseDetail";
import DirectoryPagination from "~/components/DirectoryPagination";
export function meta() {
  return [{ title: "客户来信 · Agentic Inbox" }];
}
export default function InboxRoute() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const group = params.get("group") === "work" ? "work" : "";
  const q = params.get("q") || "";
  const page = String(Math.max(1, Number(params.get("page")) || 1));
  const size = [10, 20, 50].includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 20;
  const selected = params.get("case");
  const change = (values: Record<string, string | null>, replace = false) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [key, value] of Object.entries(values)) {
          if (value) n.set(key, value);
          else n.delete(key);
        }
        return n;
      },
      { replace },
    );
  const query = useQuery({
    queryKey: ["support", "dashboard", status, group, q, page, size],
    queryFn: ({ signal }) =>
      api.getSupportDashboard(
        {
          ...(SUPPORT_STATUSES.includes(status as SupportStatus)
            ? { status }
            : {}),
          group,
          query: q,
          page,
          limit: String(size),
          hideIgnored: "true",
        },
        signal,
      ),
    refetchInterval: 30000,
  });
  const d = query.data;
  return (
    <main className={`ws-screen ws-inbox ${selected ? "ws-has-detail" : ""}`}>
      <header className="ws-heading">
        <div>
          <h1>客户来信</h1>
          <p>按处理状态查看所有项目的客户对话。</p>
        </div>
      </header>
      <div className="ws-inbox-layout">
        <section className="ws-inbox-list" aria-label="来信列表">
          <div className="ws-toolbar">
            <label className="ws-search">
              搜索
              <input
                type="search"
                placeholder="主题、邮箱或项目…"
                value={q}
                onChange={(e) =>
                  change({ q: e.target.value, page: null }, true)
                }
              />
            </label>
            <label>
              处理状态
              <select
                value={group === "work" ? "work" : status}
                onChange={(e) =>
                  change({
                    status: e.target.value === "work" ? null : e.target.value,
                    group: e.target.value === "work" ? "work" : null,
                    page: null,
                  })
                }
              >
                <option value="">全部客户工单</option>
                <option value="work">等待巡检与处理中</option>
                {SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_LABELS[s]}
                    {d ? ` (${d.counts[s]})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!d ? (
            <LoadState error={query.error} retry={() => query.refetch()} />
          ) : d.cases.length ? (
            <>
              <div className="ws-list-count">共 {d.total} 个工单</div>
              {d.cases.map((item) => (
                <div
                  key={item.id}
                  className={item.id === selected ? "ws-selected" : ""}
                >
                  <CaseRow
                    item={item}
                    to={`?${new URLSearchParams({ ...Object.fromEntries(params), case: item.id })}`}
                  />
                </div>
              ))}
              <DirectoryPagination
                unit="工单"
                page={d.page}
                totalPages={d.totalPages}
                start={(d.page - 1) * size + 1}
                end={Math.min(d.page * size, d.total)}
                total={d.total}
                pageSize={size}
                onPageChange={(p) => change({ page: String(p) })}
                onPageSizeChange={(s) =>
                  change({ size: String(s), page: null })
                }
              />
            </>
          ) : (
            <div className="ws-empty">
              <strong>{q ? "没有匹配的来信" : "当前没有这类工单"}</strong>
              <p>真实来信与处理进展会显示在这里。</p>
            </div>
          )}
        </section>
        {selected && (
          <SupportCaseDetail
            key={selected}
            id={selected}
            close={() => change({ case: null })}
          />
        )}
      </div>
    </main>
  );
}
