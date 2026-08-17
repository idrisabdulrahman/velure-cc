import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({
	requireAuthUser: vi.fn().mockResolvedValue({ _id: "user-1" }),
}));

vi.mock("./rls", () => ({
	requireWorkspaceForRead: vi.fn(),
	requireWritableWorkspace: vi.fn().mockResolvedValue({
		userId: "user-1",
		workspaceId: "workspace-1",
		role: "owner",
	}),
}));

import { saveTaxProfile } from "./compliance";

describe("tax profile tenancy", () => {
	it("rejects an update to another user's profile", async () => {
		const patch = vi.fn();
		const handler = (
			saveTaxProfile as unknown as {
				_handler: (ctx: unknown, args: unknown) => unknown;
			}
		)._handler;

		await expect(
			handler(
				{
					db: {
						get: vi.fn().mockResolvedValue({
							_id: "profile-2",
							ownerId: "user-2",
						}),
						patch,
						query: vi.fn(() => ({
							withIndex: vi.fn(() => ({
								collect: vi.fn().mockResolvedValue([]),
							})),
						})),
					},
				},
				{
					id: "profile-2",
					name: "VAT",
					jurisdictionCode: "NG",
					taxTreatment: "exclusive",
					rate: 7.5,
					label: "VAT",
					isDefault: false,
					active: true,
				},
			),
		).rejects.toThrow("Tax profile not found.");
		expect(patch).not.toHaveBeenCalled();
	});
});
