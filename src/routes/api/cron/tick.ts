import { createFileRoute } from "@tanstack/react-router";
import { safeErrorDetails } from "#/server/http-security";
import { runSchedulerTick } from "#/server/scheduler";

/**
 * POST /api/cron/tick — the single scheduler entry point.
 *
 * Identity is the shared scheduler secret (`INVOICE_SCHEDULER_SECRET`), never a
 * user session or a tenant-supplied id. In production Supabase `pg_cron` posts
 * here through `pg_net` (migration 20261029000000), reading the URL and the
 * secret from Vault. A missing secret fails closed with 401.
 *
 * A tick where any job failed answers 500 so the caller/observer sees the
 * failure, but the body still reports every job: the other jobs did run and the
 * tick is idempotent, so a retry cannot double-charge or double-send.
 */
export async function handleCronTick({ request }: { request: Request }) {
	const expected = process.env.INVOICE_SCHEDULER_SECRET;
	if (
		!expected ||
		request.headers.get("authorization") !== `Bearer ${expected}`
	) {
		return Response.json(
			{ ok: false, error: "Unauthorized." },
			{ status: 401 },
		);
	}

	try {
		const summary = await runSchedulerTick();
		return Response.json(summary, { status: summary.ok ? 200 : 500 });
	} catch (error) {
		console.error("Scheduler tick failed", safeErrorDetails(error));
		return Response.json(
			{ ok: false, error: "Scheduler tick failed." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/cron/tick")({
	server: {
		handlers: {
			POST: handleCronTick,
		},
	},
});
