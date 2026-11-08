import { WorkerEntrypoint } from "cloudflare:workers";
import { receiveEmail } from "./index";
import type { Env } from "./types";

// A named service entrypoint, accessible only through an explicit service binding.
// Public HTTP requests continue to use the Access-protected default entrypoint.
export class InboxArchive extends WorkerEntrypoint<Env> {
	async fetch(request: Request) {
		const to = request.headers.get("x-envelope-to");
		const size = Number(request.headers.get("x-raw-size"));
		if (request.method !== "POST" || !request.body || !to || !Number.isSafeInteger(size) || size <= 0) {
			return new Response("Invalid archive request", { status: 400 });
		}
		const result = await receiveEmail({
			raw: request.body,
			rawSize: size,
			to,
			from: request.headers.get("x-envelope-from") || undefined,
		}, this.env, this.ctx as ExecutionContext, { archiveOnly: true });
		return Response.json(result);
	}
}
