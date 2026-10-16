import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf } from "#/server/pdf";
import { getInvoiceByToken } from "#/server/public-invoice-repository";
import { handle } from "./$id";

vi.mock("#/server/public-invoice-repository", () => ({
	getInvoiceByToken: vi.fn(),
}));
vi.mock("#/server/pdf", () => ({ renderInvoicePdf: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("public invoice PDF route", () => {
	it("does not write the bearer token to failure logs", async () => {
		vi.mocked(getInvoiceByToken).mockResolvedValue({
			id: "invoice-1",
			token: "secret-public-token",
			invoiceNumber: "INV-001",
		} as never);
		vi.mocked(renderInvoicePdf).mockRejectedValue(new Error("render failed"));
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({
			params: { id: "secret-public-token" },
		});

		expect(response.status).toBe(500);
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
			"secret-public-token",
		);
		expect(errorLog).toHaveBeenCalledWith("PDF download error:", {
			invoiceId: "invoice-1",
			name: "Error",
		});
	});
});
