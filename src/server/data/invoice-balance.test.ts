import { describe, expect, it } from "vitest";
import {
	collectibleBalance,
	deliveredAtForInvoice,
	deriveInvoiceStatus,
	invoiceNetPayable,
	isCollectibleStatus,
	isOverdueInvoice,
} from "./invoice-balance";

/**
 * WS3 — the ONE collectible-balance authority.
 *
 * These are the rules every surface (Invoices, Clients, Reports, Reminders)
 * now shares, so they are pinned here once: net payable is the amount basis,
 * open balance is `netPayable − paymentAmount` for collectible statuses only,
 * and overdue needs a positive balance, a past due date AND delivery evidence.
 */

const now = new Date("2026-06-23T12:00:00.000Z");

const delivered = Date.parse("2026-06-01T00:00:00.000Z");

describe("invoiceNetPayable", () => {
	it("uses net payable when present and never the gross total", () => {
		expect(
			invoiceNetPayable({
				compliance: {
					netPayable: 519_400,
					grandTotal: 530_000,
					withholdingTaxAmount: 10_600,
				},
			}),
		).toBe(519_400);
	});

	it("falls back to grandTotal minus withholding tax", () => {
		expect(
			invoiceNetPayable({
				compliance: {
					grandTotal: 530_000,
					withholdingTaxAmount: 10_600,
				},
			}),
		).toBe(519_400);
	});

	it("falls back to the line-item sum when no compliance is stored", () => {
		expect(
			invoiceNetPayable({
				lineItems: [
					{ quantity: 2, price: 1_000 },
					{ quantity: 1, price: 500 },
				],
			}),
		).toBe(2_500);
	});

	it("clamps a negative or non-finite value to zero", () => {
		expect(invoiceNetPayable({ compliance: { netPayable: -50 } })).toBe(0);
		expect(invoiceNetPayable({ compliance: { netPayable: Number.NaN } })).toBe(
			0,
		);
	});
});

describe("deliveredAtForInvoice", () => {
	it("prefers real delivery evidence over the updatedAt fallback", () => {
		expect(
			deliveredAtForInvoice({
				status: "unpaid",
				deliveredAt: delivered,
				updatedAt: delivered + 5,
			}),
		).toBe(delivered);
	});

	it("uses the guarded updatedAt fallback only once a row has left draft", () => {
		expect(
			deliveredAtForInvoice({ status: "unpaid", updatedAt: delivered }),
		).toBe(delivered);
	});

	it("never fabricates a delivery time for a stored draft", () => {
		expect(
			deliveredAtForInvoice({ status: "draft", updatedAt: delivered }),
		).toBeUndefined();
	});
});

describe("deriveInvoiceStatus", () => {
	it("does not count a created-but-unsent row as overdue", () => {
		expect(
			deriveInvoiceStatus(
				{
					status: "draft",
					dueDate: "2026-01-01",
					paymentAmount: 0,
					compliance: { netPayable: 1_000 },
					updatedAt: delivered,
				},
				now,
			),
		).toBe("draft");
	});

	it("marks a delivered past-due unpaid invoice overdue", () => {
		expect(
			deriveInvoiceStatus(
				{
					status: "unpaid",
					dueDate: "2026-06-01",
					deliveredAt: delivered,
					paymentAmount: 0,
					compliance: { netPayable: 1_000 },
				},
				now,
			),
		).toBe("overdue");
	});

	it("keeps a delivered future invoice unpaid", () => {
		expect(
			deriveInvoiceStatus(
				{
					status: "unpaid",
					dueDate: "2026-07-01",
					deliveredAt: delivered,
					paymentAmount: 0,
					compliance: { netPayable: 1_000 },
				},
				now,
			),
		).toBe("unpaid");
	});

	it("derives paid and partially-paid from the amount basis", () => {
		const base = {
			status: "unpaid",
			dueDate: "2026-06-01",
			deliveredAt: delivered,
			compliance: { netPayable: 1_000 },
		};
		expect(deriveInvoiceStatus({ ...base, paymentAmount: 1_000 }, now)).toBe(
			"paid",
		);
		expect(deriveInvoiceStatus({ ...base, paymentAmount: 400 }, now)).toBe(
			"partially-paid",
		);
	});

	it("keeps canceled and scheduled rows out of the collectible set", () => {
		expect(
			deriveInvoiceStatus({ status: "canceled", canceledAt: delivered }, now),
		).toBe("canceled");
		expect(
			deriveInvoiceStatus(
				{ scheduledAt: delivered, scheduleVersion: "v1" },
				now,
			),
		).toBe("scheduled");
		expect(isCollectibleStatus("canceled")).toBe(false);
		expect(isCollectibleStatus("scheduled")).toBe(false);
	});
});

describe("collectibleBalance", () => {
	it("is net payable minus payment, floored at zero", () => {
		expect(
			collectibleBalance({
				status: "partially-paid",
				dueDate: "2026-06-01",
				deliveredAt: delivered,
				paymentAmount: 9_400,
				compliance: { netPayable: 519_400, grandTotal: 530_000 },
			}),
		).toBe(510_000);
	});

	it("is zero for drafts even with a positive amount", () => {
		expect(
			collectibleBalance({
				status: "draft",
				dueDate: "2026-06-01",
				paymentAmount: 0,
				compliance: { netPayable: 519_400 },
				updatedAt: delivered,
			}),
		).toBe(0);
	});

	it("is zero for paid and canceled rows", () => {
		expect(
			collectibleBalance({
				status: "paid",
				dueDate: "2026-06-01",
				deliveredAt: delivered,
				paymentAmount: 1_000,
				compliance: { netPayable: 1_000 },
			}),
		).toBe(0);
		expect(
			collectibleBalance({
				status: "canceled",
				canceledAt: delivered,
				paymentAmount: 0,
				compliance: { netPayable: 1_000 },
			}),
		).toBe(0);
	});
});

describe("isOverdueInvoice", () => {
	it("requires delivery evidence, so a past-due draft is never overdue", () => {
		expect(
			isOverdueInvoice(
				{
					status: "draft",
					dueDate: "2026-01-01",
					paymentAmount: 0,
					compliance: { netPayable: 1_000 },
					updatedAt: delivered,
				},
				now,
			),
		).toBe(false);
	});

	it("is true for a delivered past-due balance and false otherwise", () => {
		const base = {
			status: "unpaid",
			dueDate: "2026-06-01",
			paymentAmount: 0,
			compliance: { netPayable: 1_000 },
		};
		expect(isOverdueInvoice({ ...base, deliveredAt: delivered }, now)).toBe(
			true,
		);
		expect(
			isOverdueInvoice(
				{ ...base, dueDate: "2026-07-01", deliveredAt: delivered },
				now,
			),
		).toBe(false);
		expect(
			isOverdueInvoice(
				{ ...base, paymentAmount: 1_000, deliveredAt: delivered },
				now,
			),
		).toBe(false);
	});
});
