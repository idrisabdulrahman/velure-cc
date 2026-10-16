import { describe, expect, it } from "vitest";
import { duplicateInvoiceNumberSet, duplicateInvoiceRowCount } from "./cleanup";

describe("invoice cleanup helpers", () => {
	it("counts duplicate rows instead of duplicate number groups", () => {
		const invoices = [
			...Array.from({ length: 9 }, () => ({
				invoiceNumber: "INV-2026-000001",
			})),
			{ invoiceNumber: "FR35NOINC-2026-0005" },
		];

		expect(duplicateInvoiceNumberSet(invoices)).toEqual(
			new Set(["INV-2026-000001"]),
		);
		expect(duplicateInvoiceRowCount(invoices)).toBe(9);
		console.log("cleanup refresh contract passed");
	});

	it("keeps cleanup safety checks in the server boundary", async () => {
		const source = await import("node:fs/promises").then((fs) =>
			fs.readFile(
				new URL("../../server/data/invoices.ts", import.meta.url),
				"utf8",
			),
		);
		expect(source).toContain("invoiceHasRelatedRecords");
		expect(source).toContain('["draft", "canceled"]');
		expect(source).toContain('.eq("workspace_id", workspaceId)');
		console.log("cleanup safety contract passed");
	});
});
