import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WP-E — the read-only viewer seat is enforced by Postgres RLS, not just by
 * the UI. This is the source-level proof: the A9 policy file admits any
 * member for SELECT (viewer included) but requires `owner | member` for every
 * write on the main surfaces. If someone widens a write policy to viewers, or
 * narrows member SELECT, this fails.
 *
 * The behavioural counterpart runs live under `A10_LIVE=1`
 * (`rls-tenancy.live.test.ts`); this suite is the always-on guard.
 */

const sql = readFileSync(
	fileURLToPath(
		new URL(
			"../../../supabase/migrations/20260815190830_phase_a9_activate_rls_policies.sql",
			import.meta.url,
		),
	),
	"utf8",
);

/** Split the migration into `create policy <name> ...` blocks. */
function policyBlocks(source: string): Map<string, string> {
	const blocks = new Map<string, string>();
	const starts = [...source.matchAll(/create policy\s+([a-z0-9_]+)/gi)];
	for (let i = 0; i < starts.length; i++) {
		const name = starts[i][1];
		const from = starts[i].index ?? 0;
		const to = starts[i + 1]?.index ?? source.length;
		blocks.set(name, source.slice(from, to));
	}
	return blocks;
}

const WRITE_PREDICATE = "m.role in ('owner', 'member')";

describe("viewer RLS posture", () => {
	const blocks = policyBlocks(sql);

	it("lets any workspace member (viewer included) read the member list", () => {
		const select = blocks.get("workspace_members_select");
		expect(select).toBeDefined();
		expect(select).toContain("app.is_workspace_member(workspace_id)");
	});

	it("does not permit a member to update or delete their own membership", () => {
		expect(blocks.has("workspace_members_update")).toBe(false);
		expect(blocks.has("workspace_members_delete")).toBe(false);
	});

	it.each([
		"invoices_insert",
		"invoices_update",
		"invoices_delete",
		"clients_insert",
		"clients_update",
		"clients_delete",
		"products_insert",
		"products_update",
		"products_delete",
	])("requires owner|member for %s", (policy) => {
		const block = blocks.get(policy);
		expect(block, `missing policy ${policy}`).toBeDefined();
		expect(block).toContain(WRITE_PREDICATE);
		// The read/write split: a write policy never admits a viewer.
		expect(block).not.toContain("viewer");
	});
});
