import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WP-E route contract: GET/POST /api/workspace/members.
 *
 * The session, the workspace resolution, the directory and the service-role
 * insert are all faked; the handler's validation, role gate and error mapping
 * run for real.
 */

const {
	getContextMock,
	getWorkspaceContextMock,
	findUserIdByEmailMock,
	listWorkspaceMembersMock,
	addWorkspaceMemberMock,
	poolMock,
} = vi.hoisted(() => ({
	getContextMock: vi.fn(),
	getWorkspaceContextMock: vi.fn(),
	findUserIdByEmailMock: vi.fn(),
	listWorkspaceMembersMock: vi.fn(),
	addWorkspaceMemberMock: vi.fn(),
	poolMock: { tag: "pg-pool" },
}));

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: getContextMock,
}));
vi.mock("#/server/data/workspaces", () => ({
	getWorkspaceContext: getWorkspaceContextMock,
}));
vi.mock("#/server/data/workspace-members", () => ({
	findUserIdByEmail: findUserIdByEmailMock,
	listWorkspaceMembers: listWorkspaceMembersMock,
	addWorkspaceMember: addWorkspaceMemberMock,
}));
vi.mock("#/server/member-directory", () => ({
	getMemberDirectoryPool: () => poolMock,
}));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: () => "admin-client",
}));

import { handleGet, handlePost } from "./members";

const CONTEXT = { client: { tag: "user-scoped" }, userId: "owner-1" };

function get() {
	return new Request("http://velure.test/api/workspace/members");
}

function post(body: unknown, raw?: string) {
	return new Request("http://velure.test/api/workspace/members", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ?? JSON.stringify(body),
	});
}

afterEach(() => vi.clearAllMocks());

describe("GET /api/workspace/members", () => {
	it("401s without a session and reads nothing", async () => {
		getContextMock.mockResolvedValue(null);

		const response = await handleGet({ request: get() });

		expect(response.status).toBe(401);
		expect(listWorkspaceMembersMock).not.toHaveBeenCalled();
	});

	it("returns the session workspace's members to a viewer", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		getWorkspaceContextMock.mockResolvedValue({
			workspaceId: "ws-1",
			role: "viewer",
		});
		listWorkspaceMembersMock.mockResolvedValue([
			{ userId: "owner-1", email: "owner@example.com", role: "owner" },
		]);

		const response = await handleGet({ request: get() });

		expect(response.status).toBe(200);
		expect(listWorkspaceMembersMock).toHaveBeenCalledWith(poolMock, "ws-1");
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			role: "viewer",
			members: [{ userId: "owner-1", role: "owner" }],
		});
	});

	it("403s when the session has no active workspace", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		getWorkspaceContextMock.mockResolvedValue(null);

		const response = await handleGet({ request: get() });

		expect(response.status).toBe(403);
		expect(listWorkspaceMembersMock).not.toHaveBeenCalled();
	});
});

describe("POST /api/workspace/members", () => {
	function ownerSession() {
		getContextMock.mockResolvedValue(CONTEXT);
		getWorkspaceContextMock.mockResolvedValue({
			workspaceId: "ws-1",
			role: "owner",
		});
	}

	it("401s without a session", async () => {
		getContextMock.mockResolvedValue(null);

		const response = await handlePost({ request: post({ email: "a@b.com" }) });

		expect(response.status).toBe(401);
		expect(addWorkspaceMemberMock).not.toHaveBeenCalled();
	});

	it.each(["member", "viewer"])(
		"403s when the caller is a %s",
		async (role) => {
			getContextMock.mockResolvedValue(CONTEXT);
			getWorkspaceContextMock.mockResolvedValue({
				workspaceId: "ws-1",
				role,
			});

			const response = await handlePost({
				request: post({ email: "a@b.com" }),
			});

			expect(response.status).toBe(403);
			// The gate runs before any directory lookup or write.
			expect(findUserIdByEmailMock).not.toHaveBeenCalled();
			expect(addWorkspaceMemberMock).not.toHaveBeenCalled();
		},
	);

	it("400s on an invalid email and malformed JSON", async () => {
		ownerSession();

		const invalid = await handlePost({ request: post({ email: "nope" }) });
		expect(invalid.status).toBe(400);

		const malformed = await handlePost({ request: post({}, "{oops") });
		expect(malformed.status).toBe(400);

		expect(addWorkspaceMemberMock).not.toHaveBeenCalled();
	});

	it("422s with an actionable message when no account exists", async () => {
		ownerSession();
		findUserIdByEmailMock.mockResolvedValue(null);

		const response = await handlePost({
			request: post({ email: "Unknown@Example.com" }),
		});

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body).toMatchObject({ ok: false, code: "invitee_not_found" });
		expect(body.error).toMatch(/create an account first/i);
		expect(findUserIdByEmailMock).toHaveBeenCalledWith(
			poolMock,
			"unknown@example.com",
		);
		expect(addWorkspaceMemberMock).not.toHaveBeenCalled();
	});

	it("invites the resolved account as a viewer of the session workspace", async () => {
		ownerSession();
		findUserIdByEmailMock.mockResolvedValue("accountant-1");
		addWorkspaceMemberMock.mockResolvedValue("added");

		const response = await handlePost({
			request: post({ email: "Accountant@Example.com" }),
		});

		expect(response.status).toBe(201);
		expect(addWorkspaceMemberMock).toHaveBeenCalledWith("admin-client", {
			workspaceId: "ws-1",
			userId: "accountant-1",
			role: "viewer",
			invitedBy: "owner-1",
		});
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			member: { userId: "accountant-1", role: "viewer" },
		});
	});

	it("409s a duplicate membership instead of failing", async () => {
		ownerSession();
		findUserIdByEmailMock.mockResolvedValue("accountant-1");
		addWorkspaceMemberMock.mockResolvedValue("already_member");

		const response = await handlePost({
			request: post({ email: "accountant@example.com" }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			code: "already_member",
		});
	});
});
