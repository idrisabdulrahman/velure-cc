import type { Database } from "#/types/database.types";
import { roundMoney } from "./payments";
import {
	resolveActiveWorkspaceId,
	type Supabase,
	type WorkspaceRole,
} from "./workspaces";

/**
 * WP-C — expense tracking, minimal (build_plan.md §WP-C).
 *
 * This is an expense **log**, not a ledger: amount, category, date and note.
 * There are no accounts, no double entry and no P&L (AGENTS.md §2).
 *
 * Tenancy (AGENTS.md §8, defense in depth):
 *   - `expenses` is workspace family. Every query carries the caller's
 *     resolved active `workspace_id`, so a member of workspace B can never
 *     read or write workspace A's rows even against a client with RLS off.
 *   - Writes additionally gate on the caller's membership role (owner|member),
 *     so a viewer cannot create, edit or void even if RLS were bypassed.
 *   - `expense_categories` is a global-reference lookup with no tenant data;
 *     it is read-only from a browser session (RLS select-to-authenticated).
 *
 * Money is major units rounded to 2 places with the app's `roundMoney` helper;
 * never float (AGENTS.md §9). Soft `voided_at` instead of a hard delete.
 */

type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type ExpenseCategoryRow =
	Database["public"]["Tables"]["expense_categories"]["Row"];

const EXPENSE_COLUMNS =
	"id, workspace_id, amount, currency, category_code, incurred_on, note, voided_at, created_at, updated_at";
const EXPENSE_PAGE_SIZE = 1000;
/** Hard stop for the paged totals scan (20k rows); keeps a runaway bounded. */
const EXPENSE_TOTALS_MAX_PAGES = 20;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExpenseCategory = {
	code: string;
	name: string;
	sortOrder: number;
};

export type ExpenseRecord = {
	id: string;
	workspaceId: string;
	amount: number;
	currency: string;
	categoryCode: string;
	incurredOn: string;
	note: string | null;
	voidedAt: number | null;
	createdAt: number | null;
	updatedAt: number | null;
};

export type ExpenseInput = {
	amount: number;
	/** Defaults to the workspace's base currency when omitted. */
	currency?: string;
	categoryCode: string;
	/** ISO `YYYY-MM-DD`. */
	incurredOn: string;
	note?: string;
};

export type ExpenseTotals = {
	currency: string;
	total: number;
	count: number;
	byCategory: Array<{ categoryCode: string; total: number; count: number }>;
	byMonth: Array<{ month: string; total: number; count: number }>;
};

export type ExpenseListArgs = {
	categoryCode?: string;
	/** Inclusive ISO `YYYY-MM-DD` bounds on `incurred_on`. */
	from?: string;
	to?: string;
	includeVoided?: boolean;
	limit?: number;
};

function epoch(value: string | null): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function toExpenseRecord(row: ExpenseRow): ExpenseRecord {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		// numeric arrives as a number through PostgREST; coerce defensively.
		amount: Number(row.amount),
		currency: row.currency,
		categoryCode: row.category_code,
		incurredOn: row.incurred_on,
		note: row.note ?? null,
		voidedAt: epoch(row.voided_at),
		createdAt: epoch(row.created_at),
		updatedAt: epoch(row.updated_at),
	};
}

function toExpenseCategory(row: ExpenseCategoryRow): ExpenseCategory {
	return {
		code: row.code,
		name: row.name,
		sortOrder: row.sort_order,
	};
}

const normalize = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

function normalizeAmount(amount: number): number {
	if (typeof amount !== "number" || !Number.isFinite(amount)) {
		throw new Error("Expense amount must be a number.");
	}
	const rounded = roundMoney(amount);
	if (rounded <= 0) {
		throw new Error("Expense amount must be greater than zero.");
	}
	return rounded;
}

function normalizeIncurredOn(value: string): string {
	const trimmed = value.trim();
	if (
		!DATE_ONLY_RE.test(trimmed) ||
		Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))
	) {
		throw new Error("Expense date must be a valid date.");
	}
	return trimmed;
}

function normalizeCategoryCode(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error("An expense category is required.");
	}
	return trimmed;
}

/**
 * Resolve the caller's active workspace and confirm they may write to it.
 *
 * The membership role read is the app-layer write gate: RLS refuses a viewer
 * too, but the test fake has no RLS, so the role check has to live here
 * (AGENTS.md §8). A viewer still reads (RLS/policy admits them on SELECT).
 */
async function resolveWritableWorkspace(
	client: Supabase,
	userId: string,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { data, error } = await client
		.from("workspace_members")
		.select("role")
		.eq("user_id", userId)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;

	const role = (data?.role ?? null) as WorkspaceRole | null;
	if (role !== "owner" && role !== "member") {
		throw new Error("You do not have permission to change expenses.");
	}
	return workspaceId;
}

async function resolveWorkspaceCurrency(
	client: Supabase,
	workspaceId: string,
): Promise<string> {
	const { data, error } = await client
		.from("workspaces")
		.select("base_currency")
		.eq("id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data?.base_currency?.trim() || "NGN";
}

/** Confirm the expense exists in the caller's workspace before a write. */
async function assertExpenseInWorkspace(
	client: Supabase,
	workspaceId: string,
	expenseId: string,
): Promise<void> {
	const { data, error } = await client
		.from("expenses")
		.select("id")
		.eq("id", expenseId)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	// 22P02 = invalid input syntax (a crafted non-uuid id). Report the same
	// not-found the scoped read returns instead of leaking a raw Postgres
	// error to the caller (AGENTS.md §8: no SQL in responses).
	if (error) {
		if (error.code === "22P02") throw new Error("Expense not found.");
		throw error;
	}
	if (!data) throw new Error("Expense not found.");
}

/**
 * Read expense rows for one workspace, paging past PostgREST's default row cap
 * so totals never silently under-count a large log. `maxRows` bounds the scan.
 */
async function loadExpenseRows(
	client: Supabase,
	workspaceId: string,
	args: ExpenseListArgs,
	maxRows: number,
): Promise<ExpenseRecord[]> {
	const collected: ExpenseRecord[] = [];
	const maxPages = Math.min(
		EXPENSE_TOTALS_MAX_PAGES,
		Math.ceil(maxRows / EXPENSE_PAGE_SIZE) || 1,
	);

	for (let page = 0; page < maxPages; page++) {
		if (collected.length >= maxRows) break;
		const from = page * EXPENSE_PAGE_SIZE;
		let query = client
			.from("expenses")
			.select(EXPENSE_COLUMNS)
			.eq("workspace_id", workspaceId)
			// `id` as a secondary key makes each `range()` page window
			// deterministic when many rows share an `incurred_on` date, so a
			// paged totals scan can neither skip nor double-count a row.
			.order("incurred_on", { ascending: false })
			.order("id", { ascending: true });
		if (args.categoryCode) query = query.eq("category_code", args.categoryCode);
		if (args.from) query = query.gte("incurred_on", args.from);
		if (args.to) query = query.lte("incurred_on", args.to);
		if (!args.includeVoided) query = query.is("voided_at", null);

		const { data, error } = await query.range(
			from,
			from + EXPENSE_PAGE_SIZE - 1,
		);
		if (error) throw error;
		const pageRows = ((data ?? []) as ExpenseRow[]).map(toExpenseRecord);
		collected.push(...pageRows);
		if (pageRows.length < EXPENSE_PAGE_SIZE) break;
	}

	// Newest first, with the most recently recorded row winning a same-day tie;
	// this display order is independent of the `id`-tiebroken page windows above.
	collected.sort((a, b) => {
		const byDate = b.incurredOn.localeCompare(a.incurredOn);
		if (byDate !== 0) return byDate;
		return (b.createdAt ?? 0) - (a.createdAt ?? 0);
	});
	return collected.slice(0, maxRows);
}

/**
 * The seeded, server-managed category set. Global reference data: no tenant
 * filter exists because no tenant data is stored here; RLS allows every
 * authenticated session to read and nobody to write.
 */
export async function listExpenseCategories(
	client: Supabase,
): Promise<ExpenseCategory[]> {
	const { data, error } = await client
		.from("expense_categories")
		.select("code, name, sort_order, is_active")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });
	if (error) throw error;
	return ((data ?? []) as ExpenseCategoryRow[]).map(toExpenseCategory);
}

/** List the caller's workspace expenses, newest first. Voided rows are omitted. */
export async function listExpenses(
	client: Supabase,
	userId: string,
	args: ExpenseListArgs = {},
): Promise<ExpenseRecord[]> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];
	const limit = Math.max(1, Math.min(args.limit ?? 500, EXPENSE_PAGE_SIZE));
	return loadExpenseRows(client, workspaceId, args, limit);
}

/** Create an expense in the caller's active workspace. Returns the new id. */
export async function createExpense(
	client: Supabase,
	userId: string,
	input: ExpenseInput,
): Promise<string> {
	const workspaceId = await resolveWritableWorkspace(client, userId);
	const amount = normalizeAmount(input.amount);
	const incurredOn = normalizeIncurredOn(input.incurredOn);
	const categoryCode = normalizeCategoryCode(input.categoryCode);
	const currency =
		normalize(input.currency)?.toUpperCase() ??
		(await resolveWorkspaceCurrency(client, workspaceId));

	const { data, error } = await client
		.from("expenses")
		.insert({
			workspace_id: workspaceId,
			owner_id: userId,
			amount,
			currency,
			category_code: categoryCode,
			incurred_on: incurredOn,
			note: normalize(input.note) ?? null,
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

/** Update an existing expense (amount, category, date, note, currency). */
export async function updateExpense(
	client: Supabase,
	userId: string,
	id: string,
	input: ExpenseInput,
): Promise<string> {
	const workspaceId = await resolveWritableWorkspace(client, userId);
	await assertExpenseInWorkspace(client, workspaceId, id);

	const amount = normalizeAmount(input.amount);
	const incurredOn = normalizeIncurredOn(input.incurredOn);
	const categoryCode = normalizeCategoryCode(input.categoryCode);
	const currency = normalize(input.currency)?.toUpperCase();

	const { error } = await client
		.from("expenses")
		.update({
			amount,
			// Only touch the stored currency when the caller supplies one;
			// an omitted field must leave the row's currency unchanged.
			...(currency ? { currency } : {}),
			category_code: categoryCode,
			incurred_on: incurredOn,
			note: normalize(input.note) ?? null,
			updated_at: new Date().toISOString(),
		})
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return id;
}

/**
 * Void an expense (soft delete). The row stays in the log; it drops out of
 * lists and totals. A financial record is never hard-deleted (AGENTS.md §9).
 */
export async function voidExpense(
	client: Supabase,
	userId: string,
	id: string,
): Promise<string> {
	const workspaceId = await resolveWritableWorkspace(client, userId);
	await assertExpenseInWorkspace(client, workspaceId, id);

	const now = new Date().toISOString();
	// The `.is("voided_at", null)` guard makes the void idempotent: a repeat
	// void (a stale double-click, or two tabs racing) matches no row and leaves
	// the original `voided_at` untouched. `.select("id")` makes that observable
	// — a `null` result means the row was already voided — so the no-op is
	// deliberate rather than an accidental "success".
	const { error } = await client
		.from("expenses")
		.update({ voided_at: now, updated_at: now })
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.is("voided_at", null)
		.select("id")
		.maybeSingle();
	if (error) throw error;
	return id;
}

/**
 * Pure aggregation over already-loaded rows. Sums in the app money type and
 * rounds every total through `roundMoney`, so `0.1 + 0.2` is `0.3` — never a
 * float artifact. Rows in another currency are ignored (single-currency
 * workspace log; the currency is chosen by `getExpenseTotals`).
 */
export function buildExpenseTotals(
	rows: ExpenseRecord[],
	currency: string,
): ExpenseTotals {
	const normalizedCurrency = currency.trim().toUpperCase() || "NGN";
	const inCurrency = rows.filter(
		(row) =>
			row.voidedAt === null &&
			row.currency.trim().toUpperCase() === normalizedCurrency,
	);

	let total = 0;
	const byCategory = new Map<string, { total: number; count: number }>();
	const byMonth = new Map<string, { total: number; count: number }>();
	for (const row of inCurrency) {
		total += row.amount;
		const category = byCategory.get(row.categoryCode) ?? {
			total: 0,
			count: 0,
		};
		category.total += row.amount;
		category.count += 1;
		byCategory.set(row.categoryCode, category);

		const month = row.incurredOn.slice(0, 7);
		const bucket = byMonth.get(month) ?? { total: 0, count: 0 };
		bucket.total += row.amount;
		bucket.count += 1;
		byMonth.set(month, bucket);
	}

	return {
		currency: normalizedCurrency,
		total: roundMoney(total),
		count: inCurrency.length,
		byCategory: [...byCategory.entries()]
			.map(([categoryCode, value]) => ({
				categoryCode,
				total: roundMoney(value.total),
				count: value.count,
			}))
			.sort((a, b) => b.total - a.total),
		byMonth: [...byMonth.entries()]
			.map(([month, value]) => ({
				month,
				total: roundMoney(value.total),
				count: value.count,
			}))
			.sort((a, b) => a.month.localeCompare(b.month)),
	};
}

/**
 * Totals for the caller's active workspace. The dominant stored currency
 * labels the report (the log is single-currency in practice); voided rows are
 * excluded by `buildExpenseTotals`.
 */
export async function getExpenseTotals(
	client: Supabase,
	userId: string,
	args: Pick<ExpenseListArgs, "from" | "to"> = {},
): Promise<ExpenseTotals | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const rows = await loadExpenseRows(
		client,
		workspaceId,
		{ from: args.from, to: args.to },
		EXPENSE_PAGE_SIZE * EXPENSE_TOTALS_MAX_PAGES,
	);

	const counts = new Map<string, number>();
	for (const row of rows) {
		if (row.voidedAt !== null) continue;
		const key = row.currency.trim().toUpperCase();
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const currency =
		[...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NGN";
	return buildExpenseTotals(rows, currency);
}
