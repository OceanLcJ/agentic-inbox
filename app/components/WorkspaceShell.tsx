import {
  ChartBarIcon,
  TrayIcon,
  ClockCounterClockwiseIcon,
  FoldersIcon,
  EnvelopeIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { NavLink, Link, useLocation, useMatch } from "react-router";
import Sidebar from "./Sidebar";
import WorkspaceCompose from "./WorkspaceCompose";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

const links = [
  ["/", "仪表盘", ChartBarIcon],
  ["/inbox", "客户来信", TrayIcon],
  ["/records", "处理记录", ClockCounterClockwiseIcon],
  ["/projects", "项目邮箱", FoldersIcon],
] as const;
export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const mailbox = useMatch("/mailbox/:mailboxId/*")?.params.mailboxId;
  const selected = new URLSearchParams(location.search).get("case");
  const detail = useQuery({
    queryKey: ["support", "case", selected],
    queryFn: ({ signal }) => api.getSupportCase(selected!, signal),
    enabled: !!selected,
  });
  const composeFrom = mailbox || detail.data?.case.mailboxId;
  return (
    <div className="workspace-shell">
      <a className="workspace-skip" href="#workspace-content">
        跳到主要内容
      </a>
      <aside className="workspace-rail">
        <Link className="workspace-brand" to="/">
          <EnvelopeIcon size={22} weight="bold" />
          <span>
            Agentic Inbox<small>项目邮件工作台</small>
          </span>
        </Link>
        <nav className="workspace-nav" aria-label="主导航">
          {links.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `workspace-nav-link ${isActive || (to === "/inbox" && location.pathname === "/support") ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Link
          className="workspace-compose-link"
          to={`${location.pathname}${location.search ? `${location.search}&` : "?"}compose=1${composeFrom ? `&from=${encodeURIComponent(composeFrom)}` : ""}`}
        >
          <PencilSimpleIcon size={17} />
          写邮件
        </Link>
        {mailbox ? (
          <div className="workspace-mail-context">
            <Sidebar mailboxIdOverride={mailbox} embedded />
          </div>
        ) : (
          <div className="workspace-rail-note">
            需要你决定的事放在首页。
            <br />
            每一步处理都留有记录。
          </div>
        )}
      </aside>
      <div className="workspace-content" id="workspace-content" tabIndex={-1}>
        {children}
      </div>
      <WorkspaceCompose />
    </div>
  );
}
