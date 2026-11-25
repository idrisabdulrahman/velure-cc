import { describe, expect, it } from "vitest";
import { buildCustomerStatement } from "./client-intelligence";

type InvoiceInput = Parameters<
	typeof buildCustomerStatement
>[0]["invoices"][number];

const CLIENT = {
	name: "Acme Ltd",
	email: "billing@acme.test",
	currency: "NGN",
};

function invoice(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		id: "inv-1",
		invoiceNumber: "INV-001",
		customerName: "Acme Ltd",
		currency: "NGN",
		issueDate: "2026-01-10",
		dueDate: "2026-02-10",
		status: "unpaid",
		paymentAmount: 0,
		deliveredAt: Date.parse("2026-01-10T00:00:00Z"),
		lineItems: [{ name: "Service", quantity: 1, price: 1000 }],
		...overrides,
	};
}

describe("buildCustomerStatement", () => {
	it("matches by buyer email or customer name and sums billed/paid/outstanding", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-03-01T00:00:00Z"),
			invoices: [
				invoice({
					id: "paid",
					invoiceNumber: "INV-001",
					paymentAmount: 1000,
					lineItems: [{ name: "Service", quantity: 1, price: 1000 }],
				}),
				// Matched by buyer email only (name differs).
				invoice({
					id: "partial",
					invoiceNumber: "INV-002",
					customerName: "Acme Limited",
					dueDate: "2026-01-01",
					paymentAmount: 500,
					compliance: { buyer: { email: "billing@acme.test" } },
					lineItems: [{ name: "Service", quantity: 1, price: 2000 }],
				}),
				invoice({
					id: "overdue",
					invoiceNumber: "INV-003",
					dueDate: "2026-01-01",
					lineItems: [{ name: "Service", quantity: 1, price: 300 }],
				}),
				// Not this client.
				invoice({
					id: "other",
					invoiceNumber: "INV-999",
					customerName: "Other Co",
					compliance: { buyer: { email: "ap@other.test" } },
				}),
			],
		});

		expect(statement.invoiceCount).toBe(3);
		expect(statement.lines.map((line) => line.invoiceNumber)).toEqual([
			"INV-001",
			"INV-002",
			"INV-003",
		]);
		expect(statement.primaryTotals).toMatchObject({
			currency: "NGN",
			billed: 3300,
			paid: 1500,
			outstanding: 1800,
			overdue: 1800,
			invoiceCount: 3,
		});
	});

	it("excludes drafts and cancelled invoices", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-03-01T00:00:00Z"),
			invoices: [
				invoice({ id: "draft", deliveredAt: undefined }),
				invoice({
					id: "canceled",
					status: "canceled",
					canceledAt: Date.parse("2026-02-01T00:00:00Z"),
				}),
				invoice({ id: "live", invoiceNumber: "INV-010" }),
			],
		});

		expect(statement.lines.map((line) => line.id)).toEqual(["live"]);
		expect(statement.invoiceCount).toBe(1);
	});

	it("bounds the issue date inclusively when from/to are given", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-06-01T00:00:00Z"),
			from: "2026-01-01",
			to: "2026-03-31",
			invoices: [
				invoice({ id: "before", issueDate: "2025-12-31" }),
				invoice({
					id: "in-from",
					invoiceNumber: "INV-020",
					issueDate: "2026-01-01",
				}),
				invoice({
					id: "in-to",
					invoiceNumber: "INV-021",
					issueDate: "2026-03-31",
				}),
				invoice({ id: "after", issueDate: "2026-04-01" }),
			],
		});

		expect(statement.lines.map((line) => line.id)).toEqual([
			"in-from",
			"in-to",
		]);
		expect(statement.from).toBe("2026-01-01");
		expect(statement.to).toBe("2026-03-31");
	});

	it("groups totals per currency with the client currency first", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-03-01T00:00:00Z"),
			invoices: [
				invoice({
					id: "usd",
					invoiceNumber: "INV-030",
					currency: "USD",
					lineItems: [{ name: "Service", quantity: 1, price: 50 }],
				}),
				invoice({
					id: "ngn",
					invoiceNumber: "INV-031",
					lineItems: [{ name: "Service", quantity: 1, price: 1000 }],
				}),
			],
		});

		expect(statement.totalsByCurrency.map((group) => group.currency)).toEqual([
			"NGN",
			"USD",
		]);
		expect(statement.primaryTotals.currency).toBe("NGN");
		// USD must not be summed into the NGN totals.
		expect(statement.primaryTotals.billed).toBe(1000);
	});

	it("returns zeroed totals when no invoice matches", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-03-01T00:00:00Z"),
			invoices: [
				invoice({
					id: "other",
					customerName: "Other Co",
					compliance: { buyer: { email: "ap@other.test" } },
				}),
			],
		});

		expect(statement.invoiceCount).toBe(0);
		expect(statement.totalsByCurrency).toEqual([]);
		expect(statement.primaryTotals).toEqual({
			currency: "NGN",
			billed: 0,
			paid: 0,
			outstanding: 0,
			overdue: 0,
			invoiceCount: 0,
		});
	});

	it("marks a past-due unpaid invoice overdue but not a future one", () => {
		const statement = buildCustomerStatement({
			client: CLIENT,
			now: new Date("2026-03-01T00:00:00Z"),
			invoices: [
				invoice({
					id: "late",
					invoiceNumber: "INV-040",
					dueDate: "2026-02-01",
				}),
				invoice({
					id: "future",
					invoiceNumber: "INV-041",
					dueDate: "2026-04-01",
				}),
			],
		});

		expect(statement.lines.find((line) => line.id === "late")?.overdue).toBe(
			true,
		);
		expect(statement.lines.find((line) => line.id === "future")?.overdue).toBe(
			false,
		);
		expect(statement.primaryTotals.overdue).toBe(1000);
	});
});
