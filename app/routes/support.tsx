import { Button } from "@cloudflare/kumo";
import {
	ArrowSquareOutIcon,
	ChatCircleTextIcon,
	CheckCircleIcon,
	ClockIcon,
	EnvelopeIcon,
	LifebuoyIcon,
	MagnifyingGlassIcon,
	ArrowsClockwiseIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
	SUPPORT_LABELS,
	SUPPORT_STATUSES,
	type SupportStatus,
} from "../../shared/support";
import DirectoryPagination from "~/components/DirectoryPagination";
import api from "~/services/api";
import { mailboxProject } from "~/lib/mailbox-projects";

export function meta() {
	return [{ title: "客服处理 · Agentic Inbox" }];
}
const date = (value?: string) =>
	value
		? new Intl.DateTimeFormat("zh-CN", {
				timeZone: "Asia/Shanghai",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}).format(new Date(value))
		: "尚无记录";
const actorLabel = { system: "系统", agent: "Codex", operator: "你" };

export default function SupportRoute() {
	const [params, setParams] = useSearchParams();
	const client = useQueryClient();
	const statusParam = params.get("status") ?? "pending";
	const status = SUPPORT_STATUSES.includes(statusParam as SupportStatus)
		? (statusParam as SupportStatus)
		: undefined;
	const query = params.get("q") ?? "";
	const page = Math.max(1, Number(params.get("page")) || 1);
	const limit = [10, 20, 50].includes(Number(params.get("size")))
		? Number(params.get("size"))
		: 20;
	const selectedId = params.get("case");
	const detailRef = useRef<HTMLElement>(null);
	const [instruction, setInstruction] = useState("");
	const [deliveryOutcome, setDeliveryOutcome] = useState<
		"accepted" | "failed" | ""
	>("");
	const [deliveryEvidence, setDeliveryEvidence] = useState("");
	const [providerReceipt, setProviderReceipt] = useState("");
	const [notice, setNotice] = useState("");
	const [instructionNotice, setInstructionNotice] = useState("");
	const [reconcileNotice, setReconcileNotice] = useState("");
	const [now, setNow] = useState(0);
	useEffect(() => {
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 30000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		setInstruction("");
		setDeliveryOutcome("");
		setDeliveryEvidence("");
		setProviderReceipt("");
		setNotice("");
		setInstructionNotice("");
		setReconcileNotice("");
	}, [selectedId]);
	const change = (values: Record<string, string | null>, replace = false) =>
		setParams(
			(current) => {
				const next = new URLSearchParams(current);
				for (const [key, value] of Object.entries(values)) {
					if (value) next.set(key, value);
					else next.delete(key);
				}
				return next;
			},
			{ replace },
		);
	const dashboard = useQuery({
		queryKey: ["support", "dashboard", status, query, page, limit],
		queryFn: ({ signal }) =>
			api.getSupportDashboard(
				{
					...(status ? { status } : {}),
					query,
					page: String(page),
					limit: String(limit),
				},
				signal,
			),
		refetchInterval: 30000,
	});
	const detail = useQuery({
		queryKey: ["support", "case", selectedId],
		queryFn: ({ signal }) => api.getSupportCase(selectedId!, signal),
		enabled: Boolean(selectedId),
		refetchInterval: 30000,
	});
	useEffect(() => {
		if (detail.data && matchMedia("(max-width: 950px)").matches)
			detailRef.current?.scrollIntoView({ block: "start" });
	}, [selectedId, Boolean(detail.data)]);
	const refresh = () => client.invalidateQueries({ queryKey: ["support"] });
	const scan = useMutation({
		mutationFn: api.scanSupport,
		onSuccess: (result) => {
			setNotice(
				result.errors.length
					? `已检查 ${result.scanned}/${result.mailboxes} 个邮箱，部分邮箱需要重试。`
					: `已检查全部 ${result.mailboxes} 个邮箱。`,
			);
			refresh();
		},
		onError: () => setNotice("同步失败，请检查连接后重试。"),
	});
	const sendInstruction = useMutation({
		mutationFn: () =>
			api.supportInstruction(detail.data!.case, instruction.trim()),
		onMutate: () => setInstructionNotice(""),
		onSuccess: (updated) => {
			setInstruction("");
			setInstructionNotice(
				updated.delivery === "uncertain"
					? "处理意见已保存，请先核对上次投递结果。"
					: "处理意见已保存，会在下一次巡检中继续检查。",
			);
			refresh();
		},
		onError: (error) => {
			setInstructionNotice(
				error instanceof Error ? error.message : "保存失败，请重试。",
			);
			refresh();
		},
	});
	const data = dashboard.data;
	const reconcile = useMutation({
		mutationFn: () =>
			api.reconcileSupport(detail.data!.case, {
				outcome: deliveryOutcome as "accepted" | "failed",
				evidence: deliveryEvidence.trim(),
				...(providerReceipt.trim()
					? { providerMessageId: providerReceipt.trim() }
					: {}),
			}),
		onMutate: () => setReconcileNotice(""),
		onSuccess: () => {
			setDeliveryOutcome("");
			setDeliveryEvidence("");
			setProviderReceipt("");
			setReconcileNotice("投递核对已保存，没有重新发送邮件。");
			refresh();
		},
		onError: (error) => {
			setReconcileNotice(
				error instanceof Error ? error.message : "核对结果保存失败，请重试。",
			);
			refresh();
		},
	});
	const automation = data?.automation;
	const stale = Boolean(
		now &&
		automation?.enabled &&
		(!automation.lastScanAt ||
			now - Date.parse(automation.lastScanAt) > 2 * 3600000),
	);
	const running = Boolean(
		now &&
		automation?.runningUntil &&
		Date.parse(automation.runningUntil) > now,
	);
	const hasError = Boolean(automation?.lastError || automation?.lastScanError);
	const healthLabel = !automation?.enabled
		? "巡检尚未启用"
		: running
			? "正在处理工单"
			: stale
				? "巡检未按时完成"
				: hasError
					? "巡检需要关注"
					: "每小时巡检已启用";
	const nextRun =
		automation?.enabled && now
			? new Date((Math.floor(now / 3600000) + 1) * 3600000).toISOString()
			: undefined;
	const item = detail.data?.case;
	const total = data
		? Object.values(data.counts).reduce((sum, count) => sum + count, 0)
		: 0;
	const statusViews = [
		"all",
		"pending",
		"processing",
		"needs_owner",
		"waiting_customer",
		"resolved",
		"ignored",
	] as const;
	return (
		<div
			className="mailbox-directory support-workspace min-h-screen bg-kumo-recessed text-kumo-default"
			lang="zh-CN"
		>
			<header className="directory-topbar">
				<div className="directory-topbar-inner">
					<Link to="/" className="directory-brand" aria-label="返回邮箱目录">
						<span className="directory-brand-icon">
							<EnvelopeIcon size={21} weight="bold" />
						</span>
						<span>Agentic Inbox</span>
					</Link>
					<nav className="directory-global-nav" aria-label="工作台导航">
						<Link to="/">邮箱目录</Link>
						<Link to="/support" aria-current="page">
							<LifebuoyIcon size={17} />
							客服处理
						</Link>
					</nav>
				</div>
			</header>
			<main className="support-main">
				<div className="support-heading">
					<div>
						<h1>客服处理</h1>
						<p>查看客户来信、处理过程，以及需要你决定的事项。</p>
					</div>
					<Button
						icon={<ArrowsClockwiseIcon size={16} />}
						loading={scan.isPending}
						onClick={() => scan.mutate()}
					>
						同步来信
					</Button>
				</div>
				{data && (
					<section className="support-health" aria-label="巡检运行状态">
						<div className="support-health-title">
							{stale || hasError ? (
								<WarningCircleIcon size={19} />
							) : (
								<ClockIcon size={19} />
							)}
							<strong>{healthLabel}</strong>
						</div>
						<dl>
							<div>
								<dt>最近检查</dt>
								<dd>{date(automation?.lastScanAt)}</dd>
							</div>
							<div>
								<dt>最近完成处理</dt>
								<dd>{date(automation?.lastRunFinishedAt)}</dd>
							</div>
							<div>
								<dt>下次预计</dt>
								<dd>{nextRun ? date(nextRun) : "尚未安排"}</dd>
							</div>
						</dl>
						{(stale || hasError) && (
							<p className="support-health-warning" role="alert">
								{automation?.lastError ||
									automation?.lastScanError ||
									"请检查本机 Orca 是否运行，以及邮箱服务凭据是否有效。"}
							</p>
						)}
						<p className="support-health-note">
							自动巡检在你的 Mac 开机且 Orca 运行时执行。新来信会自动进入队列。
						</p>
					</section>
				)}
				{notice && (
					<p className="support-notice" role="status">
						{notice}
					</p>
				)}
				<div className="support-layout">
					<section className="support-queue" aria-label="客服工单队列">
						<nav className="support-filters" aria-label="处理状态">
							{statusViews.map((value) => (
								<button
									key={value}
									type="button"
									aria-current={
										(value === "all" ? !status : value === status)
											? "page"
											: undefined
									}
									onClick={() =>
										change({ status: value, page: null, case: null })
									}
								>
									{value === "all" ? "全部" : SUPPORT_LABELS[value]}
									<span>
										{data
											? value === "all"
												? total
												: data.counts[value]
											: "–"}
									</span>
								</button>
							))}
						</nav>
						<label className="directory-search">
							<MagnifyingGlassIcon size={18} />
							<input
								type="search"
								aria-label="搜索客服工单"
								placeholder="搜索项目、客户邮箱或邮件主题…"
								value={query}
								onChange={(event) =>
									change({ q: event.target.value || null, page: null }, true)
								}
							/>
							{query && (
								<button
									type="button"
									aria-label="清除工单搜索"
									onClick={() => change({ q: null, page: null }, true)}
								>
									<XIcon size={16} />
								</button>
							)}
						</label>
						{dashboard.isPending ? (
							<div
								className="support-skeleton"
								aria-label="正在加载处理记录"
								role="status"
							>
								{[1, 2, 3].map((value) => (
									<div key={value} />
								))}
							</div>
						) : dashboard.isError ? (
							<div className="directory-empty" role="alert">
								<WarningCircleIcon size={28} />
								<h2>暂时无法加载处理记录</h2>
								<p>请检查登录状态和网络连接后重试。</p>
								<Button onClick={() => dashboard.refetch()}>重试</Button>
							</div>
						) : data?.cases.length ? (
							<>
								<ul className="support-case-list">
									{data.cases.map((entry) => (
										<li key={entry.id}>
											<button
												type="button"
												className="support-case-row"
												aria-pressed={entry.id === selectedId}
												onClick={() => change({ case: entry.id })}
											>
												<div className="support-case-top">
													<span
														className={`support-badge support-badge-${entry.status}`}
													>
														{SUPPORT_LABELS[entry.status]}
													</span>
													<time dateTime={entry.updatedAt}>
														{date(entry.updatedAt)}
													</time>
												</div>
												<h2>{entry.subject || "（无主题）"}</h2>
												<p className="support-case-address">
													{entry.mailboxId.split("@")[1]}
													<span>{entry.sender || "发件人待核实"}</span>
												</p>
												<p className="support-case-summary">{entry.summary}</p>
											</button>
										</li>
									))}
								</ul>
								<DirectoryPagination
									unit="工单"
									page={data.page}
									totalPages={data.totalPages}
									start={(data.page - 1) * limit + 1}
									end={Math.min(data.page * limit, data.total)}
									total={data.total}
									pageSize={limit}
									onPageChange={(value) =>
										change({ page: value > 1 ? String(value) : null })
									}
									onPageSizeChange={(value) =>
										change({ size: String(value), page: null })
									}
								/>
							</>
						) : (
							<div className="directory-empty">
								<ChatCircleTextIcon size={30} />
								<h2>
									{query
										? "没有匹配的处理记录"
										: status === "pending"
											? "暂时没有待处理来信"
											: "这里还没有处理记录"}
								</h2>
								<p>
									{query
										? "试试其他项目、邮箱或关键词。"
										: "真实来信和后续处理会出现在这里。你可以切换状态查看其他记录。"}
								</p>
							</div>
						)}
						{data && (
							<section className="support-recent" aria-label="最近活动">
								<h2>最近活动</h2>
								{data.recentEvents.length ? (
									<ol>
										{data.recentEvents.slice(0, 6).map((event) => (
											<li key={event.id}>
												<span>{actorLabel[event.actor]}</span>
												<p>{event.summary}</p>
												<time>{date(event.createdAt)}</time>
											</li>
										))}
									</ol>
								) : (
									<p>第一次检查或处理完成后，这里会保留实际记录。</p>
								)}
							</section>
						)}
					</section>
					<aside
						ref={detailRef}
						className="support-detail"
						aria-label="工单处理详情"
					>
						{!selectedId ? (
							<div className="support-detail-empty">
								<LifebuoyIcon size={28} />
								<h2>处理过程都留在这里</h2>
								<p>选择一条来信，查看处理依据、已发送的回复和下一步安排。</p>
							</div>
						) : detail.isPending ? (
							<p className="p-6" role="status">
								正在加载详情…
							</p>
						) : detail.isError || !item ? (
							<div className="p-6" role="alert">
								无法加载这条记录。
								<Button onClick={() => detail.refetch()}>重试</Button>
							</div>
						) : (
							<>
								<div className="support-detail-heading">
									<span
										className={`support-badge support-badge-${item.status}`}
									>
										{SUPPORT_LABELS[item.status]}
									</span>
									<h2>{item.subject || "（无主题）"}</h2>
									<p>
										{item.mailboxId}
										<br />
										{mailboxProject(item.mailboxId.split("@")[1]).description}
									</p>
									<Link
										className="support-mail-link"
										to={`/mailbox/${item.mailboxId}/emails/inbox?email=${encodeURIComponent(item.latestEmailId)}`}
									>
										打开原邮件
										<ArrowSquareOutIcon size={14} />
									</Link>
								</div>
								<div className="support-detail-body">
									<h3>目前结果</h3>
									<p>{item.summary}</p>
									{item.delivery && (
										<p
											className={
												item.delivery === "accepted"
													? "support-delivery"
													: "support-health-warning"
											}
										>
											{item.delivery === "accepted"
												? "邮件服务已接受回复；这不等于客户已阅读。"
												: item.delivery === "uncertain"
													? "投递结果待核实，自动化不会重复发送。"
													: "上次发送失败，原因已保留在记录中。"}
										</p>
									)}
									<h3>下一步</h3>
									<p>
										{item.nextAction ||
											(item.status === "waiting_customer"
												? "等待客户回复，新来信会重新进入待处理。"
												: item.status === "resolved" ||
													  item.status === "ignored"
													? "当前无需继续处理；新来信仍会重新进入队列。"
													: "等待巡检继续检查这条来信。")}
									</p>
									<h3>处理时间线</h3>
									<ol className="support-timeline">
										{detail.data!.events.map((event) => (
											<li key={event.id}>
												<div className="support-event-meta">
													<span>{actorLabel[event.actor]}</span>
													<time>{date(event.createdAt)}</time>
												</div>
												<p>{event.summary}</p>
												{event.replyText && (
													<details>
														<summary>查看回复内容</summary>
														<p>{event.replyText}</p>
													</details>
												)}
												{event.evidence && (
													<details>
														<summary>查看处理依据</summary>
														<p>{event.evidence}</p>
													</details>
												)}
												{event.providerMessageId && (
													<p className="support-provider-receipt">
														邮件服务编号：{event.providerMessageId}
													</p>
												)}
											</li>
										))}
									</ol>
									{item.delivery === "uncertain" && (
										<form
											className="support-instruction support-reconciliation"
											onSubmit={(event) => {
												event.preventDefault();
												reconcile.mutate();
											}}
										>
											<h3>核对投递结果</h3>
											<p>
												请以邮件服务记录为依据。保存结果只更新工单，不会重新发送邮件。
											</p>
											<label htmlFor="delivery-outcome">已确认的结果</label>
											<select
												id="delivery-outcome"
												value={deliveryOutcome}
												required
												onChange={(event) =>
													setDeliveryOutcome(
														event.target.value as typeof deliveryOutcome,
													)
												}
											>
												<option value="">请选择核对结果</option>
												<option value="accepted">邮件服务已接受回复</option>
												<option value="failed">确认未发送成功</option>
											</select>
											{deliveryOutcome === "accepted" && (
												<>
													<label htmlFor="provider-receipt">
														邮件服务接受编号
													</label>
													<input
														id="provider-receipt"
														required
														maxLength={500}
														value={providerReceipt}
														onChange={(event) =>
															setProviderReceipt(event.target.value)
														}
													/>
												</>
											)}
											<label htmlFor="delivery-evidence">核对依据</label>
											<textarea
												id="delivery-evidence"
												rows={3}
												required
												minLength={5}
												maxLength={5000}
												placeholder="记录查询到的投递状态或服务错误…"
												value={deliveryEvidence}
												onChange={(event) =>
													setDeliveryEvidence(event.target.value)
												}
											/>
											<Button
												type="submit"
												loading={reconcile.isPending}
												disabled={
													!deliveryOutcome ||
													deliveryEvidence.trim().length < 5 ||
													(deliveryOutcome === "accepted" &&
														!providerReceipt.trim())
												}
											>
												保存核对结果
											</Button>
										</form>
									)}
									{reconcileNotice && (
										<p
											className="support-form-notice"
											role={reconcile.isError ? "alert" : "status"}
										>
											{reconcileNotice}
										</p>
									)}
									<form
										className="support-instruction"
										onSubmit={(event) => {
											event.preventDefault();
											sendInstruction.mutate();
										}}
									>
										<label htmlFor="support-instruction">补充处理意见</label>
										<textarea
											id="support-instruction"
											rows={3}
											maxLength={5000}
											value={instruction}
											onChange={(event) => setInstruction(event.target.value)}
											placeholder="补充情况或说明下一步希望怎么处理…"
										/>
										<Button
											type="submit"
											variant="primary"
											loading={sendInstruction.isPending}
											disabled={!instruction.trim()}
										>
											{item.delivery === "uncertain"
												? "保存补充意见"
												: "交回下一次巡检"}
										</Button>
										{instructionNotice && (
											<p
												className="support-form-notice"
												role={sendInstruction.isError ? "alert" : "status"}
											>
												{instructionNotice}
											</p>
										)}
										<p>
											{item.delivery === "uncertain"
												? "当前需要先核对投递结果，补充意见会一并保留。"
												: "保存意见会进入待处理，后续操作仍会记录在时间线中。"}
										</p>
									</form>
								</div>
							</>
						)}
					</aside>
				</div>
			</main>
		</div>
	);
}
