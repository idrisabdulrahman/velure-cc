import { describe, expect, it } from "vitest";
import {
	nextRunDateAfter,
	normalizeScheduleInput,
	periodKeyFor,
} from "./recurring";

const baseInput = {
	name: "Monthly support",
	frequency: "monthly" as const,
	interval: 1,
	startDate: "2026-01-31",
	autoSend: false,
	customerName: "Acme Services Ltd",
	currency: "NGN",
	paymentTermsDays: 14,
	lineItems: [{ id: "line-1", name: "Support", quantity: 1, price: 100_000 }],
};

describe("recurring billing rules", () => {
	it("clamps month-end billing dates safely", () => {
		expect(nextRunDateAfter("2026-01-31", "monthly", 1)).toBe("2026-02-28");
		expect(nextRunDateAfter("2026-01-31", "quarterly", 1)).toBe("2026-04-30");
	});

	it("builds monthly and quarterly period keys", () => {
		expect(periodKeyFor("2026-02-01", "monthly")).toBe("2026-02");
		expect(periodKeyFor("2026-05-15", "quarterly")).toBe("2026-Q2");
	});

	it("normalizes valid schedule input", () => {
		const result = normalizeScheduleInput({
			...baseInput,
			name: "  Monthly   support  ",
			customerName: "  Acme   Services Ltd ",
			currency: "ngn",
		});

		expect(result.name).toBe("Monthly support");
		expect(result.customerName).toBe("Acme Services Ltd");
		expect(result.currency).toBe("NGN");
		expect(result.dateFormat).toBe("ng");
		expect(result.invoiceSize).toBe("A4");
	});

	it("rejects invalid intervals and empty line items", () => {
		expect(() => normalizeScheduleInput({ ...baseInput, interval: 0 })).toThrow(
			"Billing interval must be between 1 and 12.",
		);
		expect(() =>
			normalizeScheduleInput({ ...baseInput, lineItems: [] }),
		).toThrow("At least one invoice line item is required.");
	});

	it("requires a settlement warning for foreign currency schedules", () => {
		expect(() =>
			normalizeScheduleInput({ ...baseInput, currency: "USD" }),
		).toThrow(
			"Foreign currency recurring invoices must include the CBN settlement warning.",
		);
	});
});
