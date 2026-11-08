import type { Env } from "../types";

export function supportDesk(env: Env) {
	return env.SUPPORT_DESK.get(
		env.SUPPORT_DESK.idFromName("portfolio-support-v1"),
	);
}
