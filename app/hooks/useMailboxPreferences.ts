import { useCallback, useEffect, useState } from "react";
import {
	parseMailboxPreferences,
	type MailboxPreferences,
} from "~/lib/mailbox-directory";

const STORAGE_KEY = "agentic-inbox:mailbox-preferences:v1";
const CHANGE_EVENT = "agentic-inbox:mailbox-preferences";
let memoryOnly = false;
let fallback: MailboxPreferences = { pinned: [], recent: [] };

function readPreferences() {
	if (memoryOnly) return fallback;
	try {
		return parseMailboxPreferences(localStorage.getItem(STORAGE_KEY));
	} catch {
		return fallback;
	}
}

function updatePreferences(
	update: (current: MailboxPreferences) => MailboxPreferences,
) {
	fallback = update(readPreferences());
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
	} catch {
		memoryOnly = true;
		// Preferences still work for this session when browser storage is unavailable.
	}
	window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: fallback }));
}

export function useMailboxPreferences() {
	const [preferences, setPreferences] = useState<MailboxPreferences>({
		pinned: [],
		recent: [],
	});
	useEffect(() => {
		setPreferences(readPreferences());
		const onChange = (event: Event) =>
			setPreferences((event as CustomEvent<MailboxPreferences>).detail);
		const onStorage = (event: StorageEvent) => {
			if (event.key === STORAGE_KEY || event.key === null)
				setPreferences(readPreferences());
		};
		window.addEventListener(CHANGE_EVENT, onChange);
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener(CHANGE_EVENT, onChange);
			window.removeEventListener("storage", onStorage);
		};
	}, []);
	const togglePin = useCallback(
		(id: string) =>
			updatePreferences((current) => ({
				...current,
				pinned: current.pinned.includes(id)
					? current.pinned.filter((item) => item !== id)
					: [...current.pinned, id],
			})),
		[],
	);
	const recordVisit = useCallback(
		(id: string) =>
			updatePreferences((current) => ({
				...current,
				recent: [id, ...current.recent.filter((item) => item !== id)].slice(
					0,
					8,
				),
			})),
		[],
	);
	return { ...preferences, togglePin, recordVisit };
}
