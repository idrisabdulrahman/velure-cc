import { describe, expect, it } from "vitest";
import { assertInvoiceInput } from "./invoices";

const line = (overrides: Record<string, unknown> = {}) => ({
	id: "line-1",
	name: "Service",
	quantity: 1,
	price: 100,
	...overrides,
});

const base = {
	invoiceNumber: "INV-2026-0001",
	currency: "NGN",
	lineItems: [line()],
};

describe("assertInvoiceInput discount guards", () => {
	it("accepts an invoice-level before-tax discount", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: {
					includeDiscount: true,
					discount: 20,
					discountMode: "invoice_before_tax",
				},
			}),
		).not.toThrow();
	});

	it("accepts an invoice-level after-tax discount", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: {
					includeDiscount: true,
					discount: 20,
					discountMode: "invoice_after_tax",
				},
			}),
		).not.toThrow();
	});

	it("accepts line discounts in line mode", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				lineItems: [line({ discount: 20 })],
				templateSettings: { includeDiscount: true, discountMode: "line" },
			}),
		).not.toThrow();
	});

	it("rejects combining invoice-level and line-level discounts", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				lineItems: [line({ discount: 5 })],
				templateSettings: {
					includeDiscount: true,
					discount: 20,
					discountMode: "invoice_before_tax",
				},
			}),
		).toThrow(/cannot be combined/i);
	});

	it("rejects line discounts when the stored mode is invoice-level", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				lineItems: [line({ discount: 5 })],
				templateSettings: {
					includeDiscount: true,
					discount: 0,
					discountMode: "invoice_before_tax",
				},
			}),
		).toThrow(/cannot be combined/i);
	});

	it("rejects an invoice discount when the stored mode is line", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: {
					includeDiscount: true,
					discount: 10,
					discountMode: "line",
				},
			}),
		).toThrow(/cannot be combined/i);
	});

	it("rejects a discount larger than the invoice subtotal", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: {
					includeDiscount: true,
					discount: 120,
					discountMode: "invoice_after_tax",
				},
			}),
		).toThrow(/between zero and the invoice subtotal/i);
	});

	it("rejects a line discount larger than the line amount", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				lineItems: [line({ discount: 120 })],
				templateSettings: { includeDiscount: true, discountMode: "line" },
			}),
		).toThrow(/cannot exceed the line amount/i);
	});

	it("rejects an unknown discount mode", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: {
					includeDiscount: true,
					discount: 10,
					// @ts-expect-error — exercising the runtime guard against a bad payload.
					discountMode: "half_off",
				},
			}),
		).toThrow(/unknown discount mode/i);
	});
});
