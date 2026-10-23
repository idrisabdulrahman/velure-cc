import type { Supabase } from "../workspaces";

/**
 * WP3 — an in-memory Supabase client double with NO row-level security.
 *
 * The A10 data layer is "RLS-pure": every function takes a USER-scoped client
 * and either (a) additionally scopes its queries by the workspace/owner id it
 * resolves from the verified session, or (b) relies on RLS alone. This fake
 * deliberately enforces NOTHING: it answers every query from a plain table
 * store. A workspace-B caller therefore sees workspace-A rows for exactly the
 * functions whose queries carry no app-layer tenancy filter — which is what
 * `tenant-isolation.test.ts` asserts against.
 *
 * The fake is intentionally loud: unknown tables, unsupported embedded
 * resource selects, and unknown builder methods throw instead of silently
 * returning empty results, so a new query shape in the data layer fails the
 * suite rather than making it vacuously green. The single supported embed is
 * `workspace_members → workspaces` (joined on `workspace_id`), used by
 * `listWorkspaces`.
 */

type Row = Record<string, unknown>;

export type FakeTables = Record<string, Row[]>;

type SimpleFilter = {
	kind: "eq" | "neq" | "is" | "gt" | "gte" | "lt" | "lte";
	column: string;
	value: unknown;
};
type InFilter = { kind: "in"; column: string; values: unknown[] };
type Filter = SimpleFilter | InFilter;

type Result = { data: unknown; error: unknown; count?: number | null };

function matches(row: Row, filter: Filter): boolean {
	const actual = row[filter.column];
	switch (filter.kind) {
		case "eq":
			return actual === filter.value;
		case "neq":
			return actual !== filter.value;
		case "is":
			return filter.value === null
				? actual === null || actual === undefined
				: actual === filter.value;
		case "in":
			return filter.values.includes(actual);
		case "gt":
			return compare(actual, filter.value) > 0;
		case "gte":
			return compare(actual, filter.value) >= 0;
		case "lt":
			return compare(actual, filter.value) < 0;
		case "lte":
			return compare(actual, filter.value) <= 0;
	}
}

function compare(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a === null || a === undefined) return -1;
	if (b === null || b === undefined) return 1;
	if (typeof a === "number" && typeof b === "number") return a - b;
	return String(a) < String(b) ? -1 : 1;
}

function project(
	cols: string | null,
	rows: Row[],
	tables?: FakeTables,
	table?: string,
): unknown {
	if (cols === null || cols === "*") return rows;
	if (cols.includes("(")) {
		return projectEmbed(cols, rows, tables, table);
	}
	const wanted = cols
		.split(",")
		.map((column) => column.trim())
		.filter(Boolean);
	return rows.map((row) => {
		const out: Row = {};
		for (const column of wanted) out[column] = row[column];
		return out;
	});
}

/**
 * The one embedded join the data layer uses that this fake supports:
 * `workspace_members → workspaces` via `workspace_id`. Any other embed
 * still throws loudly.
 */
function projectEmbed(
	cols: string,
	rows: Row[],
	tables?: FakeTables,
	table?: string,
): unknown {
	const embed = /workspaces\(([^)]+)\)/.exec(cols);
	const plain = cols
		.replace(/workspaces\([^)]+\)/, "")
		.split(",")
		.map((column) => column.trim())
		.filter(Boolean);
	if (!embed || table !== "workspace_members" || !tables) {
		throw new Error(
			`fake-db: embedded resource selects are not supported (${cols})`,
		);
	}
	const nested = embed[1]
		.split(",")
		.map((column) => column.trim())
		.filter(Boolean);
	const workspaces = tables.workspaces ?? [];
	return rows.map((row) => {
		const related = workspaces.find(
			(candidate) => candidate.id === row.workspace_id,
		);
		const out: Row = {};
		for (const column of plain) out[column] = row[column];
		if (related) {
			const nestedOut: Row = {};
			for (const column of nested) nestedOut[column] = related[column];
			out.workspaces = nestedOut;
		} else {
			out.workspaces = null;
		}
		return out;
	});
}

const MULTIPLE_ROWS = {
	code: "PGRST116",
	message: "fake-db: multiple rows returned where single was expected",
};

/**
 * PostgREST's default cap on an UNBOUNDED read (Supabase `max-rows`). The
 * fake emulates it for plain SELECTs so a data-layer query that must page (or
 * must filter) fails here instead of passing against an infinite store.
 * Explicit `.limit()` / `.range()` windows and `count: head` queries are not
 * capped, and write paths deliberately keep matching every row so a partial
 * write can never hide behind a green test.
 */
const DEFAULT_MAX_ROWS = 1000;

class FakeBuilder implements PromiseLike<Result> {
	private action: "select" | "insert" | "update" | "delete" = "select";
	private filters: Filter[] = [];
	private columns: string | null = null;
	private values: Row[] | null = null;
	private patch: Row | null = null;
	private head = false;
	private limitValue: number | null = null;
	private rangeValue: { from: number; to: number } | null = null;
	private orderValue: { column: string; ascending: boolean } | null = null;
	private terminal: "none" | "single" | "maybeSingle" = "none";
	private counter = 0;

	constructor(
		private readonly tables: FakeTables,
		private readonly table: string,
	) {
		if (!(table in tables)) {
			throw new Error(`fake-db: unknown table "${table}"`);
		}
	}

	select(columns = "*", options?: { count?: string; head?: boolean }) {
		void options;
		this.columns = columns;
		if (options?.head) this.head = true;
		return this;
	}

	/** supabase-js accepts a single row or a batch; both are supported. */
	insert(values: Row | Row[]) {
		this.action = "insert";
		this.values = Array.isArray(values) ? values : [values];
		return this;
	}

	update(patch: Row) {
		this.action = "update";
		this.patch = patch;
		return this;
	}

	delete() {
		this.action = "delete";
		return this;
	}

	eq(column: string, value: unknown) {
		this.filters.push({ kind: "eq", column, value });
		return this;
	}

	neq(column: string, value: unknown) {
		this.filters.push({ kind: "neq", column, value });
		return this;
	}

	is(column: string, value: unknown) {
		this.filters.push({ kind: "is", column, value });
		return this;
	}

	in(column: string, values: unknown[]) {
		this.filters.push({ kind: "in", column, values });
		return this;
	}

	gt(column: string, value: unknown) {
		this.filters.push({ kind: "gt", column, value });
		return this;
	}

	gte(column: string, value: unknown) {
		this.filters.push({ kind: "gte", column, value });
		return this;
	}

	lt(column: string, value: unknown) {
		this.filters.push({ kind: "lt", column, value });
		return this;
	}

	lte(column: string, value: unknown) {
		this.filters.push({ kind: "lte", column, value });
		return this;
	}

	order(column: string, options?: { ascending?: boolean }) {
		this.orderValue = { column, ascending: options?.ascending !== false };
		return this;
	}

	limit(value: number) {
		this.limitValue = value;
		return this;
	}

	/** Inclusive [from, to] row window — the PostgREST `Range` header. */
	range(from: number, to: number) {
		this.rangeValue = { from, to };
		return this;
	}

	single() {
		this.terminal = "single";
		return this;
	}

	maybeSingle() {
		this.terminal = "maybeSingle";
		return this;
	}

	private selected(): Row[] {
		const rows = this.tables[this.table] as Row[];
		let out = rows.filter((row) =>
			this.filters.every((filter) => matches(row, filter)),
		);
		if (this.orderValue) {
			const { column, ascending } = this.orderValue;
			out = [...out].sort((a, b) =>
				ascending
					? compare(a[column], b[column])
					: compare(b[column], a[column]),
			);
		}
		if (this.rangeValue) {
			const { from, to } = this.rangeValue;
			out = out.slice(from, to + 1);
		} else if (this.limitValue !== null) {
			out = out.slice(0, this.limitValue);
		} else if (this.action === "select" && !this.head) {
			out = out.slice(0, DEFAULT_MAX_ROWS);
		}
		return out;
	}

	private execute(): Result {
		const rows = this.tables[this.table] as Row[];
		if (this.action === "select") {
			const matched = this.selected();
			if (this.head) return { data: null, error: null, count: matched.length };
			const data = project(this.columns, matched, this.tables, this.table);
			if (this.terminal === "maybeSingle") {
				if (matched.length > 1) return { data: null, error: MULTIPLE_ROWS };
				return { data: (data as Row[])[0] ?? null, error: null };
			}
			if (this.terminal === "single") {
				if (matched.length !== 1) return { data: null, error: MULTIPLE_ROWS };
				return { data: (data as Row[])[0], error: null };
			}
			return { data, error: null };
		}
		if (this.action === "insert") {
			const inserted = (this.values ?? []).map((raw) => {
				const value = { ...raw };
				if (value.id === undefined) {
					value.id = `${this.table}-row-${++this.counter}`;
				}
				rows.push(value);
				return value;
			});
			const data = project(
				this.columns,
				inserted,
				this.tables,
				this.table,
			) as Row[];
			if (this.terminal === "single") {
				if (inserted.length !== 1) {
					return { data: null, error: MULTIPLE_ROWS };
				}
				return { data: data[0] ?? null, error: null };
			}
			if (this.terminal === "maybeSingle") {
				if (inserted.length > 1) {
					return { data: null, error: MULTIPLE_ROWS };
				}
				return { data: data[0] ?? null, error: null };
			}
			return { data, error: null };
		}
		const matched = this.selected();
		if (this.action === "update") {
			for (const row of matched) Object.assign(row, this.patch ?? {});
		} else {
			const doomed = new Set(matched);
			this.tables[this.table] = rows.filter((row) => !doomed.has(row));
		}
		if (this.terminal === "single" && matched.length !== 1) {
			return { data: null, error: MULTIPLE_ROWS };
		}
		const data = project(
			this.action === "update" ? this.columns : null,
			matched,
			this.tables,
			this.table,
		) as Row[];
		if (this.terminal !== "none") return { data: data[0] ?? null, error: null };
		return { data, error: null };
	}

	// biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is an awaitable thenable — the fake must answer `await client.from(...)...` exactly like supabase-js does. The rule targets accidental `then` in domain classes; here it is the contract under test.
	then<TResult1 = Result, TResult2 = never>(
		onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): PromiseLike<TResult1 | TResult2> {
		return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
	}
}

export type FakeSupabase = { client: Supabase; tables: FakeTables };

/**
 * Build a no-RLS Supabase double over a plain table store. The store is
 * shared by reference: tests can mutate/inspect it directly before and
 * after calling data-layer functions.
 */
export function createFakeSupabase(tables: FakeTables): FakeSupabase {
	const client = {
		from(table: string) {
			return new FakeBuilder(tables, table);
		},
		rpc(name: string) {
			throw new Error(`fake-db: rpc "${name}" is not supported`);
		},
	};
	return { client: client as unknown as Supabase, tables };
}
