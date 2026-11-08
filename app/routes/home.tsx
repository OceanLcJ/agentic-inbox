// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowRightIcon,
	ClockCounterClockwiseIcon,
	EnvelopeIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	PushPinIcon,
	SparkleIcon,
	GameControllerIcon,
	BookOpenIcon,
	WrenchIcon,
	FoldersIcon,
	LifebuoyIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import api from "~/services/api";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import { useMailboxPreferences } from "~/hooks/useMailboxPreferences";
import {
	groupMailboxes,
	mailboxDomain,
	mailboxLabel,
	type DirectoryView,
} from "~/lib/mailbox-directory";

import DirectoryPagination from "~/components/DirectoryPagination";
import {
	PROJECT_CATEGORIES,
	mailboxProject,
	paginateProjects,
	type ProjectCategory,
} from "~/lib/mailbox-projects";

const CATEGORY_ICONS = {
	ai: SparkleIcon,
	games: GameControllerIcon,
	guides: BookOpenIcon,
	tools: WrenchIcon,
	other: FoldersIcon,
};
type DirectorySection = ProjectCategory | "pinned" | "recent";

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const {
		data: mailboxes = [],
		refetch: refetchMailboxes,
		isFetched: mailboxesFetched,
		isPending: mailboxesPending,
		error: mailboxesError,
	} = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();

	const {
		data: configData,
		isPending: configPending,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const [searchParams, setSearchParams] = useSearchParams();
	const query = searchParams.get("q") ?? "";
	const updateDirectory = (
		values: Record<string, string | null>,
		replace = false,
	) => {
		setSearchParams(
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
	};
	const setQuery = (value: string) =>
		updateDirectory({ q: value || null, page: null }, true);
	const setSection = (value: DirectorySection) =>
		updateDirectory({ type: value, q: null, page: null });
	const searchRef = useRef<HTMLInputElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const focusAfterPageChange = useRef(false);
	useEffect(() => {
		if (focusAfterPageChange.current) {
			titleRef.current?.focus();
			titleRef.current?.scrollIntoView({ block: "start" });
			focusAfterPageChange.current = false;
		}
	}, [searchParams]);
	const { pinned, recent, togglePin } = useMailboxPreferences();
	useEffect(() => {
		const focusSearch = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				event.key !== "/" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				(target instanceof HTMLElement &&
					(target.closest(
						"input, textarea, select, [contenteditable=true], [role=dialog]",
					) ||
						target.isContentEditable))
			)
				return;
			event.preventDefault();
			searchRef.current?.focus();
		};
		window.addEventListener("keydown", focusSearch);
		return () => window.removeEventListener("keydown", focusSearch);
	}, []);

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched || mailboxesError)
			return;
		const existingEmails = new Set(mailboxes.map((m) => m.email.toLowerCase()));
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => {
			if (!cancelled) refetchMailboxes();
		});
		return () => {
			cancelled = true;
		};
	}, [
		emailAddresses,
		mailboxes,
		mailboxesFetched,
		mailboxesError,
		refetchMailboxes,
	]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError("请填写邮箱地址");
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: "邮箱已创建" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message =
				(err instanceof Error ? err.message : null) || "创建邮箱失败";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "邮箱已删除" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "删除邮箱失败", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const byEmail = new Map(
		mailboxes.map((mailbox) => [mailbox.email.toLowerCase(), mailbox]),
	);
	const accounts = isConfigured
		? emailAddresses.map(
				(addr) =>
					byEmail.get(addr.toLowerCase()) ?? {
						id: addr,
						email: addr,
						name: addr.split("@")[0] || addr,
					},
			)
		: mailboxes;
	const isLoading = configPending || mailboxesPending;
	const loadError = configError || mailboxesError;
	const categoryViews = PROJECT_CATEGORIES.map((category) => ({
		...category,
		icon: CATEGORY_ICONS[category.id],
		count: new Set(
			accounts
				.filter(
					(account) =>
						mailboxProject(mailboxDomain(account)).category === category.id,
				)
				.map(mailboxDomain),
		).size,
	})).filter((category) => category.id !== "other" || category.count > 0);
	const requestedSection = searchParams.get("type");
	const section: DirectorySection =
		requestedSection === "pinned" || requestedSection === "recent"
			? requestedSection
			: (categoryViews.find((category) => category.id === requestedSection)
					?.id ??
				categoryViews.find((category) => category.count > 0)?.id ??
				"ai");
	const view: DirectoryView =
		section === "pinned" || section === "recent" ? section : "all";
	const categoryAccounts =
		view === "all"
			? accounts.filter(
					(account) =>
						mailboxProject(mailboxDomain(account)).category === section,
				)
			: accounts;
	const groups = groupMailboxes(categoryAccounts, query, view, pinned, recent);
	const visibleCount = groups.reduce(
		(count, group) => count + group.accounts.length,
		0,
	);
	const requestedSize = Number(searchParams.get("size") ?? "10");
	const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 10;
	const pagination = paginateProjects(
		groups,
		Number(searchParams.get("page") ?? "1"),
		pageSize,
	);
	const changePage = (page: number) => {
		if (page === pagination.page) return;
		focusAfterPageChange.current = true;
		updateDirectory({ page: page > 1 ? String(page) : null });
	};
	const shortcutViews = [
		{
			id: "pinned" as const,
			label: "常用置顶",
			icon: PushPinIcon,
			count: accounts.filter((account) => pinned.includes(account.id)).length,
		},
		{
			id: "recent" as const,
			label: "最近访问",
			icon: ClockCounterClockwiseIcon,
			count: accounts.filter((account) => recent.includes(account.id)).length,
		},
	];
	const category = PROJECT_CATEGORIES.find((item) => item.id === section);
	const viewTitle =
		section === "pinned"
			? "常用邮箱"
			: section === "recent"
				? "最近访问"
				: (category?.label ?? "项目邮箱");
	const viewDescription =
		section === "pinned"
			? "已置顶的邮箱，跨分类快速访问"
			: section === "recent"
				? "最近打开的 8 个邮箱"
				: category?.description;

	return (
		<div
			lang="zh-CN"
			className="mailbox-directory bg-kumo-recessed text-kumo-default"
		>
			<div className="directory-workspace">
				<aside className="directory-navigation" aria-label="邮箱视图">
					<nav
						className="directory-views directory-category-views"
						aria-label="网站类型"
					>
						{categoryViews.map(({ id, label, icon: Icon, count }) => (
							<button
								key={id}
								type="button"
								aria-current={section === id ? "page" : undefined}
								onClick={() => setSection(id)}
								className="directory-view"
							>
								<Icon size={18} weight={section === id ? "fill" : "regular"} />
								<span>{label}</span>
								<span className="directory-view-count">
									{isLoading ? "–" : count}
								</span>
							</button>
						))}
					</nav>
					<nav
						className="directory-views directory-shortcut-views"
						aria-label="快捷访问"
					>
						{shortcutViews.map(({ id, label, icon: Icon, count }) => (
							<button
								key={id}
								type="button"
								aria-current={section === id ? "page" : undefined}
								onClick={() => setSection(id)}
								className="directory-view"
							>
								<Icon size={18} weight={section === id ? "fill" : "regular"} />
								<span>{label}</span>
								<span className="directory-view-count">
									{isLoading ? "–" : count}
								</span>
							</button>
						))}
					</nav>
					<p className="directory-personal-note">
						置顶常用邮箱，快速进入。
						<br />
						置顶和访问记录保存在当前浏览器。
					</p>
				</aside>
				<main className="directory-main" id="main-content">
					<div className="directory-heading">
						<div>
							<h1 ref={titleRef} tabIndex={-1}>
								{viewTitle}
							</h1>
							<p>{isLoading ? "正在加载邮箱…" : viewDescription}</p>
						</div>
						{!isConfigured && !isLoading && !loadError && (
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								onClick={() => setIsCreateOpen(true)}
							>
								新建邮箱
							</Button>
						)}
					</div>
					<div className="directory-search-row">
						<label className="directory-search">
							<MagnifyingGlassIcon size={20} aria-hidden="true" />
							<input
								ref={searchRef}
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") setQuery("");
								}}
								placeholder="搜索当前分类的域名或邮箱…"
								aria-label="搜索项目邮箱"
							/>
							{query ? (
								<button
									type="button"
									aria-label="清除搜索"
									onClick={() => {
										setQuery("");
										searchRef.current?.focus();
									}}
								>
									<XIcon size={17} />
								</button>
							) : (
								<kbd aria-hidden="true">/</kbd>
							)}
						</label>
					</div>
					{!isLoading && !loadError && (
						<p
							className="directory-result-count"
							role="status"
							aria-live="polite"
						>
							<span>
								{groups.length} 个项目 · {visibleCount} 个邮箱
							</span>
							<span>
								{view === "recent" ? "按最近访问排序" : "按域名 A–Z 排序"}
							</span>
						</p>
					)}
					{isLoading ? (
						<div className="directory-empty" role="status">
							<Loader size="lg" />
							<p>正在加载邮箱…</p>
						</div>
					) : loadError ? (
						<div className="directory-empty" role="alert">
							<EnvelopeIcon size={32} />
							<h2>暂时无法加载邮箱</h2>
							<p>请检查网络连接后重试。</p>
							<Button
								onClick={() => {
									refetchConfig();
									refetchMailboxes();
								}}
							>
								重试
							</Button>
						</div>
					) : groups.length ? (
						<section className="directory-list" aria-label={viewTitle}>
							<div className="directory-list-heading">
								<span>项目 / 域名</span>
								<span>邮箱入口</span>
							</div>
							<ul>
								{pagination.items.map(
									({ domain, accounts: domainAccounts }) => (
										<li key={domain} className="directory-project">
											<div className="directory-project-name">
												<h2>{domain}</h2>
												<span>{mailboxProject(domain).description}</span>
											</div>
											<div className="directory-project-accounts">
												{domainAccounts.map((account) => (
													<div className="directory-account" key={account.id}>
														<RouterLink
															to={`/mailbox/${account.id}`}
															className="directory-account-link"
															aria-label={`打开 ${account.email}`}
															title={account.email}
														>
															<EnvelopeIcon
																size={16}
																className="directory-account-envelope"
															/>
															<span>{mailboxLabel(account)}</span>
															<ArrowRightIcon
																size={14}
																className="directory-account-arrow"
															/>
														</RouterLink>
														<button
															type="button"
															className="directory-pin"
															aria-label={`${pinned.includes(account.id) ? "取消置顶" : "置顶"} ${account.email}`}
															aria-pressed={pinned.includes(account.id)}
															title={
																pinned.includes(account.id)
																	? "取消置顶"
																	: "置顶邮箱"
															}
															onClick={() => togglePin(account.id)}
														>
															<PushPinIcon
																size={16}
																weight={
																	pinned.includes(account.id)
																		? "fill"
																		: "regular"
																}
															/>
														</button>
														{!isConfigured && (
															<button
																type="button"
																className="directory-pin"
																aria-label={`删除邮箱 ${account.email}`}
																onClick={() => {
																	setMailboxToDelete({
																		id: account.id,
																		email: account.email,
																	});
																	setIsDeleteOpen(true);
																}}
															>
																<TrashIcon size={16} />
															</button>
														)}
													</div>
												))}
											</div>
										</li>
									),
								)}
							</ul>
						</section>
					) : (
						<div className="directory-empty">
							<span className="directory-empty-icon">
								{query ? (
									<MagnifyingGlassIcon size={28} />
								) : view === "pinned" ? (
									<PushPinIcon size={28} />
								) : view === "recent" ? (
									<ClockCounterClockwiseIcon size={28} />
								) : (
									<EnvelopeIcon size={28} />
								)}
							</span>
							<h2>
								{query
									? "没有找到匹配的邮箱"
									: view === "pinned"
										? "把常用邮箱放在这里"
										: view === "recent"
											? "最近访问的邮箱会显示在这里"
											: "还没有邮箱"}
							</h2>
							<p>
								{query
									? `当前分类下没有找到“${query}”，请试试其他关键词或切换网站类型。`
									: view === "pinned"
										? "点击邮箱旁的图钉，即可添加常用快捷入口。"
										: view === "recent"
											? "打开任意邮箱后，下次就能从这里快速进入。"
											: "创建邮箱，开始接收和回复项目邮件。"}
							</p>
							{query ? (
								<Button onClick={() => setQuery("")}>清除搜索</Button>
							) : view !== "all" ? (
								<Button onClick={() => setSection("ai")}>浏览 AI 产品</Button>
							) : (
								!isConfigured && (
									<Button
										variant="primary"
										onClick={() => setIsCreateOpen(true)}
									>
										创建邮箱
									</Button>
								)
							)}
						</div>
					)}
					{!isLoading && !loadError && groups.length > 0 && (
						<DirectoryPagination
							{...pagination}
							total={groups.length}
							pageSize={pageSize}
							onPageChange={changePage}
							onPageSizeChange={(size) =>
								updateDirectory({ size: String(size), page: null })
							}
						/>
					)}
				</main>
			</div>

			{/* Create Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-5">
						创建新邮箱
					</Dialog.Title>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<Text variant="error" size="sm">
								{createError}
							</Text>
						)}
						<div>
							<span className="text-sm font-medium text-kumo-default mb-1.5 block">
								邮箱地址
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label="邮箱前缀"
										placeholder="info"
										size="sm"
										value={newPrefix}
										onChange={(e) => setNewPrefix(e.target.value)}
										required
									/>
								</div>
								<span className="text-sm text-kumo-subtle">@</span>
								{domains.length > 1 ? (
									<div className="flex-1">
										<Select
											aria-label="域名"
											value={selectedDomain}
											onValueChange={(value) => {
												if (value) setSelectedDomain(value);
											}}
										>
											{domains.map((d) => (
												<Select.Option key={d} value={d}>
													{d}
												</Select.Option>
											))}
										</Select>
									</div>
								) : (
									<span className="text-sm text-kumo-subtle">
										{selectedDomain || "未配置域名"}
									</span>
								)}
							</div>
						</div>
						<Input
							label="显示名称（选填）"
							placeholder="Info"
							size="sm"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										取消
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isCreating}
								disabled={!selectedDomain}
							>
								创建
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete Dialog */}
			<Dialog.Root
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						删除邮箱
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						确定删除邮箱{" "}
						<strong className="text-kumo-default">
							{mailboxToDelete?.email}
						</strong>
						？删除后无法恢复。
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									取消
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isDeleting}
							onClick={handleDelete}
						>
							删除
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
