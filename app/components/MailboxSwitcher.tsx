import { Dialog, Loader } from "@cloudflare/kumo";
import {
	CaretDownIcon,
	CheckIcon,
	MagnifyingGlassIcon,
	PushPinIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";
import { useMailboxPreferences } from "~/hooks/useMailboxPreferences";
import { useUIStore } from "~/hooks/useUIStore";
import { mailboxDomain, matchesMailbox } from "~/lib/mailbox-directory";
import { useMailboxes } from "~/queries/mailboxes";

export default function MailboxSwitcher({
	mailboxId,
	displayName,
	email,
}: {
	mailboxId?: string;
	displayName: string;
	email?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const { data: mailboxes = [], isPending, isError, refetch } = useMailboxes();
	const { pinned } = useMailboxPreferences();
	const closeSidebar = useUIStore((state) => state.closeSidebar);
	const matches = mailboxes
		.filter((mailbox) => matchesMailbox(mailbox, query))
		.sort(
			(a, b) =>
				Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) ||
				mailboxDomain(a).localeCompare(mailboxDomain(b)) ||
				a.email.localeCompare(b.email),
		);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) setQuery("");
			}}
		>
			<Dialog.Trigger
				render={(props) => (
					<button
						{...props}
						type="button"
						className="mailbox-switch-trigger"
						aria-label={`切换邮箱，当前 ${email || mailboxId}`}
					>
						<span className="min-w-0 flex-1 text-left">
							<span className="block text-base font-semibold truncate">
								{displayName}
							</span>
							<span className="block text-xs text-kumo-subtle truncate mt-1">
								{email || mailboxId}
							</span>
						</span>
						<CaretDownIcon size={16} className="shrink-0 text-kumo-subtle" />
					</button>
				)}
			/>
			<Dialog size="sm" className="mailbox-switch-dialog p-0 overflow-hidden">
				<div className="px-5 pt-5 pb-4">
					<div className="flex items-center justify-between gap-3">
						<Dialog.Title className="font-semibold text-lg">
							切换邮箱
						</Dialog.Title>
						<Dialog.Close
							render={(props) => (
								<button
									{...props}
									type="button"
									className="directory-pin"
									aria-label="关闭邮箱切换"
								>
									<XIcon size={18} />
								</button>
							)}
						/>
					</div>
					<Dialog.Description className="text-sm text-kumo-subtle mt-1 mb-4">
						搜索项目域名或邮箱地址，直接切换。
					</Dialog.Description>
					<label className="directory-search">
						<MagnifyingGlassIcon size={18} aria-hidden="true" />
						<input
							autoFocus
							type="search"
							placeholder="搜索域名或邮箱地址…"
							aria-label="搜索要切换的邮箱"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
				</div>
				<div className="mailbox-switch-results">
					{isPending ? (
						<div className="p-8 flex justify-center">
							<Loader />
						</div>
					) : isError ? (
						<div className="p-5 text-sm" role="alert">
							暂时无法加载邮箱。{" "}
							<button
								type="button"
								className="text-kumo-link underline"
								onClick={() => refetch()}
							>
								重试
							</button>
						</div>
					) : matches.length ? (
						matches.map((mailbox) => (
							<Link
								key={mailbox.id}
								to={`/mailbox/${mailbox.id}`}
								className="mailbox-switch-option"
								aria-current={mailbox.id === mailboxId ? "page" : undefined}
								onClick={() => {
									setOpen(false);
									setQuery("");
									closeSidebar();
								}}
							>
								<span className="min-w-0 flex-1">
									<span className="block font-medium truncate">
										{mailboxDomain(mailbox)}
									</span>
									<span className="block text-xs text-kumo-subtle truncate mt-0.5">
										{mailbox.email}
									</span>
								</span>
								{pinned.includes(mailbox.id) && (
									<PushPinIcon
										size={14}
										className="text-kumo-subtle"
										aria-label="已置顶"
									/>
								)}
								{mailbox.id === mailboxId && (
									<CheckIcon
										size={18}
										className="text-kumo-link"
										aria-label="当前邮箱"
									/>
								)}
							</Link>
						))
					) : (
						<p className="p-5 text-sm text-kumo-subtle">
							没有找到“{query}”对应的邮箱。
						</p>
					)}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
