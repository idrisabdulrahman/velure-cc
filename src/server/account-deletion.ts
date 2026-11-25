import type { AuthPool } from "#/server/auth-database";

/**
 * Account deletion — the data half.
 *
 * `POST /api/auth/delete-user` (Better Auth) removes the identity row and its
 * `session`/`account` children, but nothing in `public` references
 * `better_auth."user"`: `workspaces.owner_id` is a plain `text` column with no
 * foreign key, so the identity delete cannot cascade to the workspace. This
 * module performs the application-side cascade on the caller's verified user
 * id, and the `beforeDelete` hook (see `accountDeletionConfig`) runs it inside
 * the authenticated request.
 *
 * **Why the direct connection and not the RLS client.** Several owner-keyed
 * tables (`tax_profiles`, `reminder_rules`/`runs`, the `integration_*` tables)
 * have no `workspace_id` and so are not reached by the workspace cascade, and
 * `clients`/`email_events`/`invoice_exports` keep their rows with
 * `workspace_id = null` when their workspace is removed. A single transaction
 * is the only way to make "delete my account" all-or-nothing. The connection
 * is the project-owner role, which bypasses RLS, so the `owner_id`/`user_id`
 * filter — always bound to the verified Better Auth user id — is the only
 * tenant boundary here (AGENTS.md §8).
 *
 * **Order.** `workspaces` goes first so its `ON DELETE CASCADE` removes the
 * bulk of the data, and so no workspace row is left referencing a
 * `tax_profiles` row we delete next: the `(default_tax_profile_id, owner_id)`
 * composite foreign key is `ON DELETE SET NULL`, but `owner_id` is `NOT NULL`,
 * so the reverse order would raise. Every statement below targets a table that
 * the workspace cascade does not reach.
 *
 * **Immutability guards.** The issued-invoice, `invoice_audit_log` and
 * `invoice_submission_attempts` guards (migrations 20261020/20261016/20261024)
 * reject a *top-level* delete but pass a nested FK cascade through, which is
 * exactly the path taken here. Issued invoices are therefore not hard-deleted
 * by any ordinary request — only by this account-level cascade, the exception
 * those migrations were written to allow.
 */

export type AccountDeletionStatement = { table: string; sql: string };

/**
 * Statements run in order, each bound to the caller's user id. The `table`
 * label is only for the completion log.
 */
export const ACCOUNT_DELETION_STATEMENTS: AccountDeletionStatement[] = [
	{
		table: "workspaces",
		sql: "delete from public.workspaces where owner_id = $1",
	},
	{
		table: "clients",
		sql: "delete from public.clients where owner_id = $1",
	},
	{
		table: "tax_profiles",
		sql: "delete from public.tax_profiles where owner_id = $1",
	},
	{
		table: "reminder_rules",
		sql: "delete from public.reminder_rules where owner_id = $1",
	},
	{
		table: "reminder_runs",
		sql: "delete from public.reminder_runs where owner_id = $1",
	},
	{
		table: "reminder_events",
		sql: "delete from public.reminder_events where owner_id = $1",
	},
	{
		table: "integration_logs",
		sql: "delete from public.integration_logs where owner_id = $1",
	},
	{
		table: "integration_sync_jobs",
		sql: "delete from public.integration_sync_jobs where owner_id = $1",
	},
	{
		table: "integration_webhooks",
		sql: "delete from public.integration_webhooks where owner_id = $1",
	},
	{
		table: "integration_connections",
		sql: "delete from public.integration_connections where owner_id = $1",
	},
	{
		table: "email_events",
		sql: "delete from public.email_events where owner_id = $1",
	},
	{
		table: "invoice_exports",
		sql: "delete from public.invoice_exports where owner_id = $1",
	},
	{
		table: "collections_cases",
		sql: "delete from public.collections_cases where owner_id = $1",
	},
	// Memberships and the active-workspace pointer in workspaces the user does
	// not own. Owned-workspace rows already went with the workspace delete.
	{
		table: "workspace_members",
		sql: "delete from public.workspace_members where user_id = $1",
	},
	{
		table: "active_workspaces",
		sql: "delete from public.active_workspaces where user_id = $1",
	},
];

type DeletionLog = (message: string, details: Record<string, unknown>) => void;

/**
 * Run every statement in one transaction and report the per-table row counts.
 * Any failure rolls the whole deletion back, so a partial account never
 * survives.
 */
export async function deleteAccountData(
	pool: AuthPool,
	userId: string,
	log: DeletionLog = (message, details) => console.log(message, details),
): Promise<Record<string, number>> {
	const client = await pool.connect();
	const deleted: Record<string, number> = {};
	try {
		await client.query("begin");
		try {
			for (const { table, sql } of ACCOUNT_DELETION_STATEMENTS) {
				const result = await client.query(sql, [userId]);
				deleted[table] = result.rowCount ?? 0;
			}
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	} finally {
		client.release();
	}

	// Actor (opaque user id) and per-table counts only — never an email or any
	// workspace content.
	log("Deletion cascade completed", {
		event: "account.deletion",
		userId,
		deleted,
	});
	return deleted;
}

/**
 * The Better Auth `user.deleteUser` option block.
 *
 * `enabled` is the flag `POST /delete-user` gates on
 * (`better-auth/dist/api/routes/update-user.mjs` — without it the endpoint
 * answers `NOT_FOUND`, which the settings page reported as "Account deletion is
 * not enabled"). `beforeDelete` runs after session validation and before the
 * identity row is removed, so a failed cleanup aborts the whole request rather
 * than leaving an account whose data is already gone.
 */
export function accountDeletionConfig(pool: AuthPool) {
	return {
		enabled: true,
		beforeDelete: async (user: { id: string }) => {
			await deleteAccountData(pool, user.id);
		},
	};
}
