import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import api from "~/services/api";
import { ActivityList, LoadState } from "~/components/SupportCommon";
import DirectoryPagination from "~/components/DirectoryPagination";
export function meta() {
  return [{ title: "处理记录 · Agentic Inbox" }];
}
export default function RecordsRoute() {
  const [params, setParams] = useSearchParams();
  const period = params.get("period") === "today" ? "today" : "";
  const scope = params.get("scope") === "customer" ? "customer" : "";
  const page = String(Math.max(1, Number(params.get("page")) || 1));
  const size = [10, 20, 50].includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 20;
  const query = useQuery({
    queryKey: ["support", "activity", period, scope, page, size],
    queryFn: ({ signal }) =>
      api.getSupportActivity(
        { period, scope, page, limit: String(size) },
        signal,
      ),
    refetchInterval: 30000,
  });
  const update = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set(key, value);
      if (key !== "page") n.delete("page");
      return n;
    });
  const d = query.data;
  return (
    <main className="ws-screen">
      <header className="ws-heading">
        <div>
          <h1>处理记录</h1>
          <p>回复、核查、处理意见和巡检结果都保留在这里。</p>
        </div>
      </header>
      <div className="ws-toolbar">
        <label>
          时间
          <select
            value={period}
            onChange={(e) => update("period", e.target.value)}
          >
            <option value="">全部时间</option>
            <option value="today">今天（北京时间）</option>
          </select>
        </label>
        <label>
          范围
          <select
            value={scope}
            onChange={(e) => update("scope", e.target.value)}
          >
            <option value="">客户工单与巡检</option>
            <option value="customer">客户工单处理</option>
          </select>
        </label>
      </div>
      {!d ? (
        <LoadState error={query.error} retry={() => query.refetch()} />
      ) : d.total ? (
        <>
          <ActivityList events={d.events} />
          <DirectoryPagination
            unit="记录"
            page={d.page}
            totalPages={d.totalPages}
            start={(d.page - 1) * size + 1}
            end={Math.min(d.page * size, d.total)}
            total={d.total}
            pageSize={size}
            onPageChange={(p) => update("page", String(p))}
            onPageSizeChange={(s) => update("size", String(s))}
          />
        </>
      ) : (
        <div className="ws-empty">
          <strong>这个范围内还没有处理记录</strong>
          <p>实际处理后会自动留存，可切换时间和范围查看。</p>
        </div>
      )}
    </main>
  );
}
