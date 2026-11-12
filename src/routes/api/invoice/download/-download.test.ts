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

		expect(response.status).toBe(503);
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
			"secret-public-token",
		);
		expect(errorLog).toHaveBeenCalledWith("PDF download error:", {
			invoiceId: "invoice-1",
			name: "Error",
		});
	});

	it("returns a retryable HTML error instead of a substitute PDF", async () => {
		vi.mocked(getInvoiceByToken).mockResolvedValue({
			id: "invoice-1",
			token: "public-token",
			invoiceNumber: "INV-001",
		} as never);
		vi.mocked(renderInvoicePdf).mockRejectedValue(new Error("render failed"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({ params: { id: "public-token" } });

		expect(response.status).toBe(503);
		expect(response.headers.get("Content-Type")).toContain("text/html");
		expect(response.headers.get("Content-Disposition")).toBeNull();
		const body = await response.text();
		expect(body).not.toContain("%PDF");
		expect(body).toContain("/api/invoice/download/public-token");
	});
});
