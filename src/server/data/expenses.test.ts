import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
	buildExpenseTotals,
	createExpense,
	type ExpenseRecord,
	getExpenseTotals,
	listExpenseCategories,
	listExpenses,
	updateExpense,
	voidExpense,
} from "./expenses";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

/**
 * WP-C — expense tracking (data layer + migration contract).
 *
 *   1. CRUD scoped to the caller's resolved active workspace.
 *   2. Totals in the app money type (`0.1 + 0.2 === 0.3`), voided rows excluded.
 *   3. Tenancy: workspace B cannot read or write workspace A's expenses; a
 *      viewer cannot write even though they can read.
 *   4. The migration is reversible and enables RLS with no DELETE policy.
 */

const USER_A = "user-a";
const USER_B = "user-b";
const USER_V = "user-v"; // viewer in workspace A
const WS_A = "ws-a";
const WS_B = "ws-b";
const EXP_A1 = "expense-a1";
const EXP_A2 = "expense-a2";
const EXP_A3 = "expense-a3"; // voided
const EXP_B1 = "expense-b1";

function expenseRow(
	id: string,
	workspaceId: string,
	ownerId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		workspace_id: workspaceId,
		owner_id: ownerId,
		amount: 10,
		currency: "NGN",
		category_code: "rent",
		incurred_on: "2026-01-10",
		note: null,
		voided_at: null,
		created_at: "2026-01-10T00:00:00.000Z",
		updated_at: "2026-01-10T00:00:00.000Z",
		...overrides,
	};
}

function seed(): FakeTables {
	return {
		workspaces: [
			{ id: WS_A, name: "Alpha", base_currency: "NGN" },
			{ id: WS_B, name: "Beta", base_currency: "USD" },
		],
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
			{ user_id: USER_V, workspace_id: WS_A },
		],
		workspace_members: [
			{ workspace_id: WS_A, user_id: USER_A, role: "owner" },
			{ workspace_id: WS_A, user_id: USER_V, role: "viewer" },
			{ workspace_id: WS_B, user_id: USER_B, role: "owner" },
		],
		expense_categories: [
			{ code: "utilities", name: "Utilities", sort_order: 20, is_active: true },
			{ code: "rent", name: "Rent", sort_order: 10, is_active: true },
			{
				code: "legacy",
				name: "Legacy",
				sort_order: 5,
				is_active: false,
			},
		],
		expenses: [
			// 0.1 + 0.2 must total 0.3 (the float-artifact canary).
			expenseRow(EXP_A1, WS_A, USER_A, {
				amount: 0.1,
				category_code: "rent",
				incurred_on: "2026-01-10",
			}),
			expenseRow(EXP_A2, WS_A, USER_A, {
				amount: 0.2,
				category_code: "utilities",
				incurred_on: "2026-01-20",
			}),
			expenseRow(EXP_A3, WS_A, USER_A, {
				amount: 99,
				category_code: "rent",
				incurred_on: "2026-02-01",
				voided_at: "2026-02-02T00:00:00.000Z",
			}),
			expenseRow(EXP_B1, WS_B, USER_B, {
				amount: 50,
				currency: "USD",
				category_code: "software",
				incurred_on: "2026-01-05",
			}),
		],
	};
}

let tables: FakeTables;
let client: Supabase;

beforeEach(() => {
	tables = seed();
	client = createFakeSupabase(tables).client;
});

function expense(id: string) {
	return (tables.expenses as Array<Record<string, unknown>> | undefined)?.find(
		(row) => row.id === id,
	);
}

describe("expense categories", () => {
	it("returns the shared active set ordered by sort order", async () => {
		const categories = await listExpenseCategories(client);
		expect(categories.map((entry) => entry.code)).toEqual([
			"rent",
			"utilities",
		]);
		expect(categories[0]).toEqual({
			code: "rent",
			name: "Rent",
			sortOrder: 10,
		});
	});
});

describe("expense CRUD", () => {
	it("lists only the caller's workspace, newest first, without voided rows", async () => {
		const listed = await listExpenses(client, USER_A);
		expect(listed.map((entry) => entry.id)).toEqual([EXP_A2, EXP_A1]);
		expect(listed.map((entry) => entry.amount)).toEqual([0.2, 0.1]);
	});

	it("creates an expense in the caller's workspace with the workspace currency", async () => {
		const id = await createExpense(client, USER_B, {
			amount: 12.345,
			categoryCode: "software",
			incurredOn: "2026-03-01",
			note: "Annual plan",
		});
		expect(expense(id)).toMatchObject({
			workspace_id: WS_B,
			owner_id: USER_B,
			// rounded to 2 places by the money helper
			amount: 12.35,
			currency: "USD",
			category_code: "software",
			incurred_on: "2026-03-01",
			note: "Annual plan",
		});
	});

	it("honours an explicit currency over the workspace default", async () => {
		const id = await createExpense(client, USER_B, {
			amount: 5,
			currency: "gbp",
			categoryCode: "software",
			incurredOn: "2026-03-01",
		});
		expect(expense(id)?.currency).toBe("GBP");
	});

	it("rejects a non-positive amount and a malformed date", async () => {
		await expect(
			createExpense(client, USER_A, {
				amount: 0,
				categoryCode: "rent",
				incurredOn: "2026-03-01",
			}),
		).rejects.toThrow("greater than zero");
		await expect(
			createExpense(client, USER_A, {
				amount: 10,
				categoryCode: "rent",
				incurredOn: "2026-13-40",
			}),
		).rejects.toThrow("valid date");
	});

	it("updates an expense in place", async () => {
		await updateExpense(client, USER_A, EXP_A1, {
			amount: 77.5,
			categoryCode: "utilities",
			incurredOn: "2026-01-11",
			note: "Adjusted",
		});
		expect(expense(EXP_A1)).toMatchObject({
			amount: 77.5,
			category_code: "utilities",
			incurred_on: "2026-01-11",
			note: "Adjusted",
		});
	});

	it("voids instead of deleting, and drops the row from the list", async () => {
		await voidExpense(client, USER_A, EXP_A1);
		expect(expense(EXP_A1)?.voided_at).toEqual(expect.any(String));
		const listed = await listExpenses(client, USER_A);
		expect(listed.map((entry) => entry.id)).toEqual([EXP_A2]);
	});

	it("treats a repeat void as an idempotent no-op", async () => {
		await voidExpense(client, USER_A, EXP_A1);
		const firstVoidedAt = expense(EXP_A1)?.voided_at;
		expect(firstVoidedAt).toEqual(expect.any(String));

		// A second void (stale double-click, or two tabs racing) must resolve
		// without moving the original timestamp.
		await expect(voidExpense(client, USER_A, EXP_A1)).resolves.toBe(EXP_A1);
		expect(expense(EXP_A1)?.voided_at).toBe(firstVoidedAt);
	});
});

describe("expense totals", () => {
	it("sums in the app money type: 0.1 + 0.2 is exactly 0.3", async () => {
		const totals = await getExpenseTotals(client, USER_A);
		expect(totals).not.toBeNull();
		expect(totals?.currency).toBe("NGN");
		expect(totals?.total).toBe(0.3);
		expect(totals?.count).toBe(2);
	});

	it("totals a log larger than one page without skipping or double-counting rows", async () => {
		// 1200 same-day rows overflow EXPENSE_PAGE_SIZE (1000), so the totals
		// scan needs two pages; the `id` tiebreaker keeps the windows disjoint.
		for (let i = 0; i < 1200; i++) {
			(tables.expenses as Array<Record<string, unknown>>).push(
				expenseRow(`expense-page-${i}`, WS_A, USER_A, {
					amount: 1,
					category_code: "rent",
					incurred_on: "2026-05-01",
				}),
			);
		}

		const totals = await getExpenseTotals(client, USER_A);
		// 1200 added + the two active seeded rows (EXP_A3 is voided).
		expect(totals?.count).toBe(1202);
		expect(totals?.total).toBe(1200.3);
	});

	it("builds category and month breakdowns and excludes voided rows", () => {
		const rows: ExpenseRecord[] = [
			{
				id: "1",
				workspaceId: WS_A,
				amount: 0.1,
				currency: "NGN",
				categoryCode: "rent",
				incurredOn: "2026-01-10",
				note: null,
				voidedAt: null,
				createdAt: null,
				updatedAt: null,
			},
			{
				id: "2",
				workspaceId: WS_A,
				amount: 0.2,
				currency: "NGN",
				categoryCode: "rent",
				incurredOn: "2026-01-20",
				note: null,
				voidedAt: null,
				createdAt: null,
				updatedAt: null,
			},
			{
				id: "3",
				workspaceId: WS_A,
				amount: 500,
				currency: "NGN",
				categoryCode: "utilities",
				incurredOn: "2026-02-01",
				note: null,
				voidedAt: Date.parse("2026-02-02T00:00:00Z"),
				createdAt: null,
				updatedAt: null,
			},
			{
				id: "4",
				workspaceId: WS_A,
				amount: 9,
				currency: "USD",
				categoryCode: "software",
				incurredOn: "2026-01-01",
				note: null,
				voidedAt: null,
				createdAt: null,
				updatedAt: null,
			},
		];
		const totals = buildExpenseTotals(rows, "NGN");
		expect(totals.total).toBe(0.3);
		expect(totals.count).toBe(2);
		expect(totals.byCategory).toEqual([
			{ categoryCode: "rent", total: 0.3, count: 2 },
		]);
		expect(totals.byMonth).toEqual([
			{ month: "2026-01", total: 0.3, count: 2 },
		]);
	});

	it("labels totals with the caller's dominant currency", async () => {
		const totals = await getExpenseTotals(client, USER_B);
		expect(totals?.currency).toBe("USD");
		expect(totals?.total).toBe(50);
	});
});

describe("expense tenancy", () => {
	it("never reads another workspace's expenses", async () => {
		const listed = await listExpenses(client, USER_B);
		expect(listed.map((entry) => entry.id)).toEqual([EXP_B1]);
	});

	it("refuses to update or void another workspace's expense by id", async () => {
		await expect(
			updateExpense(client, USER_B, EXP_A1, {
				amount: 1,
				categoryCode: "rent",
				incurredOn: "2026-01-10",
			}),
		).rejects.toThrow("Expense not found.");
		await expect(voidExpense(client, USER_B, EXP_A1)).rejects.toThrow(
			"Expense not found.",
		);
		expect(expense(EXP_A1)).toMatchObject({ amount: 0.1, voided_at: null });
	});

	it("lets a viewer read but never write", async () => {
		const listed = await listExpenses(client, USER_V);
		expect(listed.map((entry) => entry.id)).toEqual([EXP_A2, EXP_A1]);

		await expect(
			createExpense(client, USER_V, {
				amount: 1,
				categoryCode: "rent",
				incurredOn: "2026-03-01",
			}),
		).rejects.toThrow("permission");
		await expect(
			updateExpense(client, USER_V, EXP_A1, {
				amount: 1,
				categoryCode: "rent",
				incurredOn: "2026-01-10",
			}),
		).rejects.toThrow("permission");
		await expect(voidExpense(client, USER_V, EXP_A1)).rejects.toThrow(
			"permission",
		);
		expect(expense(EXP_A1)).toMatchObject({ amount: 0.1, voided_at: null });
	});
});

describe("expenses migration contract", () => {
	const sql = readFileSync(
		fileURLToPath(
			new URL(
				"../../../supabase/migrations/20261108000000_expenses.sql",
				import.meta.url,
			),
		),
		"utf8",
	);
	const downIndex = sql.indexOf("-- down");
	const downSql = downIndex === -1 ? "" : sql.slice(downIndex);

	it("constrains money to a positive 2dp numeric", () => {
		expect(sql).toMatch(/amount numeric\(20,\s*2\) not null/);
		expect(sql).toMatch(/check \(amount > 0\)/);
	});

	it("enables RLS with select/insert/update policies and no delete", () => {
		expect(sql).toMatch(
			/alter table public\.expenses enable row level security/,
		);
		expect(sql).toMatch(/create policy expenses_select/);
		expect(sql).toMatch(/create policy expenses_insert/);
		expect(sql).toMatch(/create policy expenses_update/);
		expect(sql).not.toMatch(/create policy expenses_delete/);
		expect(downSql).not.toMatch(/for delete/);
	});

	it("is reversible: the down section drops every object it creates", () => {
		expect(downIndex).toBeGreaterThan(-1);
		expect(downSql).toMatch(/drop table if exists public\.expenses/);
		expect(downSql).toMatch(/drop table if exists public\.expense_categories/);
		expect(downSql).toMatch(/drop policy if exists expenses_select/);
		expect(downSql).toMatch(/drop policy if exists expense_categories_select/);
	});
});
