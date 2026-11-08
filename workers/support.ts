import { DurableObject } from "cloudflare:workers";
import { SupportStore, type InboundSupport } from "./lib/support-store";
import type {
	SupportAutomation,
	SupportEvent,
	SupportReply,
	SupportStatus,
	SupportUpdate,
} from "../shared/support";
import type { Env } from "./types";

export class SupportDeskDO extends DurableObject<Env> {
	private store: SupportStore;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.store = new SupportStore(ctx.storage.sql);
	}
	private atomic<T>(command: () => T) {
		return this.ctx.storage.transactionSync(command);
	}
	registerInbound(input: InboundSupport) {
		return this.atomic(() => this.store.registerInbound(input));
	}
	syncInbound(inputs: InboundSupport[]) {
		return this.atomic(() =>
			inputs.map((input) => this.store.registerInbound(input)),
		);
	}
	dashboard(options: {
		status?: SupportStatus;
		query?: string;
		page?: number;
		limit?: number;
	}) {
		return this.store.dashboard(options);
	}
	getCaseRecord(id: string) {
		const item = this.store.getCase(id);
		return item ? { case: item, events: this.store.getEvents(id) } : null;
	}
	updateCase(id: string, update: SupportUpdate, actor: SupportEvent["actor"]) {
		return this.atomic(() => this.store.updateCase(id, update, actor));
	}
	ownerInstruction(
		id: string,
		version: number,
		operationId: string,
		text: string,
	) {
		return this.atomic(() =>
			this.store.ownerInstruction(id, version, operationId, text),
		);
	}
	addNote(
		id: string,
		version: number,
		operationId: string,
		summary: string,
		evidence: string,
		actor: SupportEvent["actor"],
	) {
		return this.atomic(() =>
			this.store.addNote(id, version, operationId, summary, evidence, actor),
		);
	}
	beginReply(id: string, request: SupportReply) {
		return this.atomic(() => this.store.beginReply(id, request));
	}
	finishReply(
		operationId: string,
		result:
			| { providerMessageId: string }
			| { error: string; definitive: boolean },
	) {
		return this.atomic(() => this.store.finishReply(operationId, result));
	}
	updateAutomation(patch: Partial<SupportAutomation>) {
		return this.atomic(() => this.store.updateAutomation(patch));
	}
	reconcileReply(
		id: string,
		version: number,
		operationId: string,
		result: {
			outcome: "accepted" | "failed";
			evidence: string;
			providerMessageId?: string;
		},
	) {
		return this.atomic(() =>
			this.store.reconcileReply(id, version, operationId, result),
		);
	}
	startRun(id: string) {
		return this.atomic(() => this.store.startRun(id));
	}
	finishRun(id: string, summary: string, error: string) {
		return this.atomic(() => this.store.finishRun(id, summary, error));
	}
}
