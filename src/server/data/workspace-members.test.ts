import { describe, expect, it, vi } from "vitest";
import {
	addWorkspaceMember,
	findUserIdByEmail,
	listWorkspaceMembers,
} from "./workspace-members";
import type { Supabase } from "./workspaces";

/**
 * WP-E data layer. The directory queries run on the server's own Postgres
 * connection (better_auth is not exposed through PostgREST), so they are
 * exercised against a fake queryable; the insert runs on the service-role
 * client, exercised against a fake admin client.
 */

type QueryRow = Record<string, unknown>;

function fakeQueryable(rows: QueryRow[]): {
	query: (text: string, values?: unknown[]) => Promise<{ rows: QueryRow[] }>;
	last: { text: string; values: unknown[] } | null;
} {
	const state = {
		last: null as { text: string; values: unknown[] } | null,
		query: vi.fn(async (text: string, values?: unknown[]) => {
			state.last = { text, values: values ?? [] };
			return { rows };
		}),
	};
	return state;
}

function fakeAdmin(insert: () => Promise<{ error: { code?: string } | null }>) {
	return {
		from: vi.fn(() => ({ insert: vi.fn(insert) })),
	} as unknown as Supabase;
}

describe("findUserIdByEmail", () => {
	it("looks the account up case-insensitively and returns its id", async () => {
		const q = fakeQueryable([{ id: "user-1" }]);

		await expect(findUserIdByEmail(q, " Account@Example.com ")).resolves.toBe(
			"user-1",
		);

		expect(q.last?.values[0]).toBe("account@example.com");
		expect(q.last?.text).toContain('better_auth."user"');
	});

	it("returns null when no account exists", async () => {
		const q = fakeQueryable([]);
		await expect(
			findUserIdByEmail(q, "nobody@example.com"),
		).resolves.toBeNull();
	});

	it("returns null for a blank email without querying", async () => {
		const q = fakeQueryable([{ id: "user-1" }]);
		await expect(findUserIdByEmail(q, "   ")).resolves.toBeNull();
		expect(q.last).toBeNull();
	});
});

describe("listWorkspaceMembers", () => {
	it("maps role, email and inviter, scoped to the workspace id", async () => {
		const q = fakeQueryable([
			{
				user_id: "owner-1",
				role: "owner",
				invited_by: null,
				created_at: "2026-01-01T00:00:00.000Z",
				email: "owner@example.com",
			},
			{
				user_id: "viewer-1",
				role: "viewer",
				invited_by: "owner-1",
				created_at: new Date("2026-01-02T00:00:00.000Z"),
				email: "accountant@example.com",
			},
		]);

		await expect(listWorkspaceMembers(q, "ws-1")).resolves.toEqual([
			{
				userId: "owner-1",
				email: "owner@example.com",
				role: "owner",
				invitedBy: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				userId: "viewer-1",
				email: "accountant@example.com",
				role: "viewer",
				invitedBy: "owner-1",
				createdAt: "2026-01-02T00:00:00.000Z",
			},
		]);
		expect(q.last?.values).toEqual(["ws-1"]);
	});

	it("keeps a member whose identity row is missing (email null)", async () => {
		const q = fakeQueryable([
			{
				user_id: "ghost-1",
				role: "member",
				invited_by: null,
				created_at: "2026-01-03T00:00:00.000Z",
				email: null,
			},
		]);

		const members = await listWorkspaceMembers(q, "ws-1");
		expect(members[0]).toMatchObject({ userId: "ghost-1", email: null });
	});
});

describe("addWorkspaceMember", () => {
	it("inserts a viewer with the session-resolved workspace and inviter", async () => {
		const insert = vi.fn(async () => ({ error: null }));
		const admin = {
			from: vi.fn(() => ({ insert })),
		} as unknown as Supabase;

		await expect(
			addWorkspaceMember(admin, {
				workspaceId: "ws-1",
				userId: "viewer-1",
				role: "viewer",
				invitedBy: "owner-1",
			}),
		).resolves.toBe("added");

		expect(admin.from).toHaveBeenCalledWith("workspace_members");
		expect(insert).toHaveBeenCalledWith({
			workspace_id: "ws-1",
			user_id: "viewer-1",
			role: "viewer",
			invited_by: "owner-1",
		});
	});

	it("treats a 23505 duplicate as already_member, not an error", async () => {
		const admin = fakeAdmin(async () => ({ error: { code: "23505" } }));

		await expect(
			addWorkspaceMember(admin, {
				workspaceId: "ws-1",
				userId: "viewer-1",
				role: "viewer",
				invitedBy: "owner-1",
			}),
		).resolves.toBe("already_member");
	});

	it("propagates any other insert failure", async () => {
		const admin = fakeAdmin(async () => ({ error: { code: "42501" } }));

		await expect(
			addWorkspaceMember(admin, {
				workspaceId: "ws-1",
				userId: "viewer-1",
				role: "viewer",
				invitedBy: "owner-1",
			}),
		).rejects.toMatchObject({ code: "42501" });
	});
});
