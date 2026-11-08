export interface InboundMessage {
	raw: ReadableStream;
	rawSize: number;
	to: string;
	from?: string;
	forward?: (destination: string) => Promise<unknown>;
}

export function resolveInboundMailbox(
	envelopeRecipient: string,
	allowedAddresses: string[],
): string | undefined {
	const recipient = envelopeRecipient.trim().toLowerCase();
	if (!recipient.includes("@")) return undefined;
	const allowed = allowedAddresses.map((address) => address.toLowerCase());
	if (allowed.length === 0 || allowed.includes(recipient)) return recipient;
	const baseAddress = recipient.replace(/\+[^@]+@/, "@");
	return allowed.includes(baseAddress) ? baseAddress : undefined;
}

export async function forwardInboundMessage(
	message: InboundMessage,
	mailboxId: string,
	settings: { forwarding?: { enabled?: boolean; email?: string } },
) {
	if (!settings.forwarding?.enabled) return;
	const destination = settings.forwarding.email?.trim().toLowerCase();
	if (!destination || !destination.includes("@") || destination === mailboxId) {
		throw new Error("Invalid forwarding destination");
	}
	if (!message.forward) throw new Error("Email forwarding is unavailable");
	await message.forward(destination);
}
