import { describe, expect, it } from "vitest";
import type { MutationCtx } from "./_generated/server";
import { recordAuditLog } from "./audit";

describe("audit logging", () => {
	it("records invoice renumber audit rows", async () => {
		let inserted:
			| {
					table: string;
					document: Record<string, unknown>;
			  }
			| undefined;
		const ctx = {
			db: {
				insert: async (table: string, document: Record<string, unknown>) => {
					inserted = { table, document };
					return "audit-log-id";
				},
			},
		} as unknown as Pick<MutationCtx, "db">;

		await recordAuditLog(ctx, {
			workspaceId: "workspace-id" as never,
			actorId: "user-id",
			action: "invoice.renumbered",
			resourceType: "invoice",
			resourceId: "invoice-id",
			metadata: {
				oldInvoiceNumber: "INV-2026-000001",
				newInvoiceNumber: "INV-2026-000002",
			},
		});

		expect(inserted?.table).toBe("audit_logs");
		expect(inserted?.document).toMatchObject({
			workspaceId: "workspace-id",
			actorId: "user-id",
			actorType: "user",
			action: "invoice.renumbered",
			resourceType: "invoice",
			resourceId: "invoice-id",
			result: "success",
			metadata: JSON.stringify({
				oldInvoiceNumber: "INV-2026-000001",
				newInvoiceNumber: "INV-2026-000002",
			}),
		});
	});
});
