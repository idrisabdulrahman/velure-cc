import { describe, expect, it } from "vitest";
import { importClientsCsv } from "./clients";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

const USER = "user-a";
const WS = "ws-a";
/** Mirrors the importer's page size for the existing-email scan. */
const PAGE_SIZE = 1000;

/**
 * Forces every insert into `table` for which `shouldFail` returns true to
 * resolve a Supabase-shaped error. The real client's builder is a
 * `PromiseLike`, so the stub is awaitable AND exposes `.select()`: the invoice
 * import chains `.insert(...).select("id")`, the client import awaits the
 * insert directly, and both must be exercisable.
 */
function makeInsertsFail(
	client: Supabase,
	table: string,
	shouldFail: (values: Record<string, unknown>) => boolean,
	message: string,
) {
	const loose = client as unknown as {
		from: (name: string) => Record<string, unknown>;
	};
	const originalFrom = loose.from.bind(loose);
	loose.from = (name: string) => {
		const builder = originalFrom(name);
		if (name !== table) return builder;
		const originalInsert = builder.insert as (values: unknown) => unknown;
		builder.insert = (values: unknown) => {
			const first = Array.isArray(values) ? values[0] : values;
			if (!shouldFail((first ?? {}) as Record<string, unknown>)) {
				return originalInsert.call(builder, values);
			}
			const result = { data: null, error: { message } };
			return {
				select: () => Promise.resolve(result),
				// biome-ignore lint/suspicious/noThenProperty: supabase query builders are thenables; the fake must be awaitable the same way.
				then: (onFulfilled: (value: unknown) => unknown) =>
					Promise.resolve(result).then(onFulfilled),
			};
		};
		return builder;
	};
}

function clientRow(id: string, email: string) {
	return {
		id,
		workspace_id: WS,
		owner_id: USER,
		name: `Client ${id}`,
		email,
		contact: { email },
		favorite: false,
		status: "active",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function seedTables(clients: FakeTables["clients"]): FakeTables {
	return {
		workspaces: [{ id: WS, owner_id: USER, name: "Alpha" }],
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		clients,
		invoices: [],
	};
}

describe("client CSV import hardening", () => {
	it("recognises an existing email that sits beyond the first page", async () => {
		// `clients_workspace_email_idx` is NOT unique, so without paging this
		// read the later email was invisible and the same address was inserted
		// again as a duplicate client.
		const target = "beyond-first-page@example.test";
		const clients = Array.from({ length: PAGE_SIZE }, (_, index) =>
			clientRow(
				`c-${String(index).padStart(4, "0")}`,
				`filler-${index}@example.test`,
			),
		);
		clients.push(clientRow("c-zzzz", target));
		const { client } = createFakeSupabase(seedTables(clients));

		const result = await importClientsCsv(client, USER, [
			{ name: "Already Here", email: target },
		]);

		expect(result.created).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([
			{ row: 2, message: "A client with this email already exists." },
		]);
	});

	it("counts real successes when one row of a chunk fails", async () => {
		// The previous `Promise.all` chunk threw on the first rejection: the
		// siblings that committed stayed in the database, `created` was not
		// incremented for the chunk, and the UI reported a total failure — so
		// the user's retry duplicated the rows that had landed.
		const { client } = createFakeSupabase(seedTables([]));
		makeInsertsFail(
			client,
			"clients",
			(values) => values.email === "boom@example.test",
			'duplicate key value violates unique constraint "clients_email_key"',
		);

		const result = await importClientsCsv(client, USER, [
			{ name: "A One", email: "a-one@example.test" },
			{ name: "B Boom", email: "boom@example.test" },
			{ name: "C Three", email: "c-three@example.test" },
		]);

		expect(result.created).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.row).toBe(3);
		expect(result.errors[0]?.message).toContain("Could not save this client");
	});

	it("reports a row with a missing email instead of throwing", async () => {
		const { client } = createFakeSupabase(seedTables([]));

		const result = await importClientsCsv(client, USER, [
			{ name: "No Email", email: "" },
		]);

		expect(result.created).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.errors[0]?.row).toBe(2);
	});
});
