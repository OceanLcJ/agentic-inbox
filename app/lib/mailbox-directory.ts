import type { Mailbox } from "~/types";
import { mailboxProject } from "./mailbox-projects";

export type DirectoryView = "all" | "pinned" | "recent";

export function mailboxDomain(mailbox: Mailbox) {
	return mailbox.email.slice(mailbox.email.lastIndexOf("@") + 1).toLowerCase();
}

export function mailboxLabel(mailbox: Mailbox) {
	return mailbox.email.split("@")[0];
}

export function matchesMailbox(mailbox: Mailbox, query: string) {
	const searchable =
		`${mailbox.email} ${mailbox.name} ${mailbox.settings?.fromName ?? ""} ${mailboxProject(mailboxDomain(mailbox)).description}`.toLowerCase();
	return query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.every((term) => searchable.includes(term));
}

export function groupMailboxes(
	mailboxes: Mailbox[],
	query = "",
	view: DirectoryView = "all",
	pinned: string[] = [],
	recent: string[] = [],
) {
	const groups = new Map<string, Mailbox[]>();
	const selected = mailboxes.filter(
		(mailbox) =>
			matchesMailbox(mailbox, query) &&
			(view !== "pinned" || pinned.includes(mailbox.id)) &&
			(view !== "recent" || recent.includes(mailbox.id)),
	);
	selected.sort((a, b) =>
		view === "recent"
			? recent.indexOf(a.id) - recent.indexOf(b.id)
			: mailboxDomain(a).localeCompare(mailboxDomain(b)) ||
				mailboxLabel(a).localeCompare(mailboxLabel(b)),
	);
	for (const mailbox of selected) {
		const domain = mailboxDomain(mailbox);
		groups.set(domain, [...(groups.get(domain) ?? []), mailbox]);
	}
	return [...groups].map(([domain, accounts]) => ({ domain, accounts }));
}

export interface MailboxPreferences {
	pinned: string[];
	recent: string[];
}

export function parseMailboxPreferences(
	raw: string | null,
): MailboxPreferences {
	try {
		const value = JSON.parse(raw ?? "{}");
		const ids = (input: unknown, limit: number) =>
			Array.isArray(input)
				? [
						...new Set(
							input.filter(
								(id): id is string =>
									typeof id === "string" && id.length > 0 && id.length <= 320,
							),
						),
					].slice(0, limit)
				: [];
		return { pinned: ids(value?.pinned, 200), recent: ids(value?.recent, 8) };
	} catch {
		return { pinned: [], recent: [] };
	}
}
