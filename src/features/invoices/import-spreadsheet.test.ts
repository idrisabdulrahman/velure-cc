import { describe, expect, it } from "vitest";
import {
	looksLikeSupplierReceivingGrid,
	parseInvoiceCsv,
	parseInvoiceDraftGrid,
} from "./import-spreadsheet";

describe("invoice spreadsheet import", () => {
	it("parses row-based invoice csv files", () => {
		const rows = parseInvoiceCsv(
			[
				"Invoice No,Customer,Description,Qty,Unit Price (NGN),Due Date",
				"INV-1,Acme Ltd,Design sprint,2,50000,2026-06-12",
			].join("\n"),
		);

		expect(rows).toEqual([
			expect.objectContaining({
				invoiceNumber: "INV-1",
				customerName: "Acme Ltd",
				description: "Design sprint",
				quantity: 2,
				price: 50000,
				dueDate: "2026-06-12",
			}),
		]);
	});

	it("parses line classification fields from CSV headers", () => {
		const rows = parseInvoiceCsv(
			[
				"Customer,Description,Qty,Price,UOM,VAT Category,Goods/Service Code,Status",
				"acme@example.test,Design sprint,2,50000,hour,Zero rated,SVC-001,unpaid",
			].join("\n"),
		);

		expect(rows[0]).toMatchObject({
			unit: "hour",
			vatCategory: "zero_rated",
			classificationCode: "SVC-001",
		});
	});

	it("extracts a draft from a formatted invoice sheet", () => {
		const draft = parseInvoiceDraftGrid([
			["", "", "", "", "", "INVOICE"],
			["Your Company Name", "", "", "", "Invoice No:", "#INV-0001"],
			["", "", "", "", "Date:", "2026-05-12"],
			["", "", "", "", "Due Date:", "2026-06-12"],
			["", "", "", "", "Status:", "UNPAID"],
			[],
			["FROM", "", "", "BILL TO"],
			["Your Name", "", "", "Client Name"],
			["hello@yourbusiness.com", "", "", "client@email.com"],
			[],
			["#", "Description", "Qty", "Unit Price (NGN)", "Amount (NGN)"],
			["1", "Sample Service / Product", "2", "75,000.00", "150,000.00"],
			["2", "Another Service", "1", "120,000.00", "120,000.00"],
			[],
			["", "", "", "Subtotal:", "270,000.00"],
			[],
			["PAYMENT DETAILS", "", "", "NOTES"],
			["Bank: Your Bank Name", "", "", "Thank you for your business!"],
		]);

		expect(draft).toEqual(
			expect.objectContaining({
				invoiceNumber: "#INV-0001",
				customerName: "Client Name",
				customerEmail: "client@email.com",
				currency: "NGN",
				status: "unpaid",
				issueDate: "2026-05-12",
				dueDate: "2026-06-12",
				lineItems: [
					{ name: "Sample Service / Product", quantity: 2, price: 75000 },
					{ name: "Another Service", quantity: 1, price: 120000 },
				],
			}),
		);
	});

	it("detects supplier receiving worksheets as outside customer invoice import", () => {
		expect(
			looksLikeSupplierReceivingGrid([
				["Supplier Invoice Receiving"],
				["Reference", "SUP-2026-03192", "Invoice Number", "INV-2026-00847"],
				["From Supplier", "GreenField Agro Supplies Ltd"],
				["Ship To", "Apex Bay 3"],
				["Item / SKU", "Qty Ordered", "Qty Received"],
				["Long-Grain Rice", "200", "200"],
			]),
		).toBe(true);
	});

	it("does not flag normal customer invoice spreadsheets as supplier receiving imports", () => {
		expect(
			looksLikeSupplierReceivingGrid([
				[
					"Invoice No",
					"Customer",
					"Customer PO Reference",
					"Description",
					"Qty",
					"Unit Price (NGN)",
				],
				["INV-1", "Acme Ltd", "PO-CLIENT-1", "Design sprint", "2", "50000"],
			]),
		).toBe(false);
	});
});
