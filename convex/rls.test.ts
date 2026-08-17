import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({
	requireAuthUser: vi.fn(),
}));

import { requireAuthUser } from "./auth";
import { requireWorkspace, requireWorkspaceForRead } from "./rls";

const mockedRequireAuthUser = vi.mocked(requireAuthUser);

function contextWithNoWorkspace() {
	return {
		db: {
			get: vi.fn(),
			query: vi.fn(() => ({
				withIndex: vi.fn(() => ({
					first: vi.fn().mockResolvedValue(null),
					collect: vi.fn().mockResolvedValue([]),
				})),
			})),
			insert: vi.fn(),
		},
	};
}

describe("workspace tenancy guards", () => {
	beforeEach(() => vi.clearAllMocks());

	it("does not create a workspace during normal access", async () => {
		mockedRequireAuthUser.mockResolvedValue({ _id: "user-1" } as never);
		const ctx = contextWithNoWorkspace();

		await expect(requireWorkspace(ctx)).rejects.toThrow("Workspace not found.");
		expect(ctx.db.insert).not.toHaveBeenCalled();
	});

	it("propagates authentication failures", async () => {
		mockedRequireAuthUser.mockRejectedValue(new Error("session unavailable"));

		await expect(
			requireWorkspaceForRead(contextWithNoWorkspace()),
		).rejects.toThrow("session unavailable");
	});
});
