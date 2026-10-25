import type { InvoiceStatus, VatCategory } from "./types";

export type InvoiceImportRow = {
	invoiceNumber?: string;
	customerName: string;
	currency?: string;
	status?: InvoiceStatus;
	issueDate?: string;
	dueDate?: string;
	description: string;
	quantity?: number;
	price?: number;
	unit?: string;
	vatCategory?: VatCategory;
	classificationCode?: string;
	notes?: string;
	paymentDetails?: string;
	paymentLink?: string;
};

export type ImportedInvoiceDraft = {
	invoiceNumber?: string;
	customerName?: string;
	customerEmail?: string;
	currency?: string;
	status?: InvoiceStatus;
	issueDate?: string;
	dueDate?: string;
	notes?: string;
	paymentDetails?: string;
	lineItems: Array<{
		name: string;
		quantity: number;
		price: number;
		unit?: string;
		vatCategory?: "standard" | "zero_rated" | "exempt";
		classificationCode?: string;
	}>;
};

const STATUS_OPTIONS: InvoiceStatus[] = [
	"draft",
	"unpaid",
	"partially-paid",
	"paid",
	"overdue",
	"canceled",
];

export function parseCsvLine(line: string) {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];
		if (char === '"' && quoted && next === '"') {
			cell += '"';
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (char === "," && !quoted) {
			cells.push(cell.trim());
			cell = "";
			continue;
		}
		cell += char;
	}

	cells.push(cell.trim());
	return cells;
}

export function parseCsvGrid(text: string) {
	return text
		.split(/\r?\n/)
		.map((line) => parseCsvLine(line))
		.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function normalizeKey(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerMatches(header: string, names: string[]) {
	return names.some(
		(name) => header === name || (name.length > 4 && header.includes(name)),
	);
}

function cellText(value: unknown) {
	return String(value ?? "").trim();
}

export function looksLikeSupplierReceivingGrid(grid: unknown[][]) {
	const text = normalizeKey(
		grid.map((row) => row.map(cellText).join(" ")).join(" "),
	);
	if (text.includes("supplierinvoice") && text.includes("receiving")) {
		return true;
	}

	const receivingSignals = [
		"fromsupplier",
		"shipto",
		"billtobuyeraccounts",
		"qtyordered",
		"qtyreceived",
		"receivinghrs",
	];
	return receivingSignals.filter((signal) => text.includes(signal)).length >= 2;
}

function parseMoney(value?: string) {
	const cleaned = (value ?? "").replace(/[^\d.-]/g, "");
	const amount = Number(cleaned);
	return Number.isFinite(amount) ? amount : 0;
}

function parseInvoiceStatus(value?: string): InvoiceStatus | undefined {
	const status = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
	if (status === "open") return "unpaid";
	if (status === "pending") return "unpaid";
	if (status === "partial" || status === "partially_paid")
		return "partially-paid";
	if (STATUS_OPTIONS.includes(status as InvoiceStatus))
		return status as InvoiceStatus;
	return undefined;
}

function normalizeDate(value?: string) {
	const text = (value ?? "").trim();
	if (!text) return undefined;
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

	const date = new Date(text);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString().slice(0, 10);
}

export function parseInvoiceCsv(text: string): InvoiceImportRow[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 2) return [];

	const headers = parseCsvLine(lines[0] ?? "").map(normalizeKey);
	const at = (cells: string[], names: string[]) => {
		const index = headers.findIndex((header) => headerMatches(header, names));
		return index >= 0 ? cells[index]?.trim() : undefined;
	};

	const hasInvoiceShape =
		headers.some((header) =>
			headerMatches(header, ["invoicenumber", "invoice", "invno", "number"]),
		) ||
		headers.some((header) =>
			headerMatches(header, [
				"customername",
				"clientname",
				"customer",
				"client",
			]),
		);

	if (!hasInvoiceShape) return [];

	return lines
		.slice(1)
		.map((line) => {
			const cells = parseCsvLine(line);
			const quantity = Math.max(
				1,
				parseMoney(at(cells, ["quantity", "qty", "units"])) || 1,
			);
			const total = parseMoney(
				at(cells, ["amount", "total", "lineamount", "linetotal"]),
			);
			const unitPrice = parseMoney(at(cells, ["price", "unitprice", "rate"]));
			const price =
				unitPrice > 0 ? unitPrice : total > 0 ? total / quantity : 0;

			return {
				invoiceNumber: at(cells, [
					"invoicenumber",
					"invoice",
					"invno",
					"number",
				]),
				customerName:
					at(cells, [
						"customername",
						"clientname",
						"customer",
						"client",
						"name",
					]) ?? "",
				currency: at(cells, ["currency", "curr"]),
				status: parseInvoiceStatus(at(cells, ["status", "state"])),
				issueDate: normalizeDate(
					at(cells, ["issuedate", "date", "invoicedate"]),
				),
				dueDate: normalizeDate(at(cells, ["duedate", "due"])),
				description:
					at(cells, [
						"description",
						"item",
						"service",
						"product",
						"lineitem",
					]) ?? "",
				quantity,
				price,
				unit: at(cells, ["unit", "unitofmeasure", "uom"]),
				vatCategory: parseVatCategory(at(cells, ["vatcategory", "vat"])),
				classificationCode: at(cells, [
					"classificationcode",
					"goodsservicecode",
					"itemcode",
				]),
				notes: at(cells, ["notes", "note", "memo"]),
				paymentDetails: at(cells, ["paymentdetails", "bankdetails"]),
				paymentLink: at(cells, ["paymentlink", "paylink"]),
			};
		})
		.filter(
			(row) => row.customerName && row.description && (row.price ?? 0) > 0,
		);
}

function parseVatCategory(value?: string): VatCategory | undefined {
	const category = value?.trim().toLowerCase().replace(/[ -]+/g, "_");
	return category === "standard" ||
		category === "zero_rated" ||
		category === "exempt"
		? category
		: undefined;
}

function valueAfterLabel(row: string[], labelIndex: number) {
	const label = row[labelIndex] ?? "";
	const inlineValue = label.split(":").slice(1).join(":").trim();
	if (inlineValue) return inlineValue;

	for (let index = labelIndex + 1; index < row.length; index += 1) {
		const value = row[index]?.trim();
		if (value) return value;
	}
	return undefined;
}

function findLabelValue(rows: string[][], labels: string[]) {
	const normalizedLabels = labels.map(normalizeKey);
	for (const row of rows) {
		for (let index = 0; index < row.length; index += 1) {
			const key = normalizeKey(row[index] ?? "");
			if (headerMatches(key, normalizedLabels)) {
				return valueAfterLabel(row, index);
			}
		}
	}
	return undefined;
}

function findSectionLines(rows: string[][], labels: string[], maxLines = 6) {
	const normalizedLabels = labels.map(normalizeKey);
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex] ?? [];
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const key = normalizeKey(row[columnIndex] ?? "");
			if (!headerMatches(key, normalizedLabels)) continue;

			const lines: string[] = [];
			for (
				let nextRowIndex = rowIndex + 1;
				nextRowIndex < Math.min(rows.length, rowIndex + 1 + maxLines);
				nextRowIndex += 1
			) {
				const value =
					rows[nextRowIndex]?.[columnIndex]?.trim() ||
					rows[nextRowIndex]?.[columnIndex + 1]?.trim() ||
					"";
				if (!value) break;
				if (normalizeKey(value).includes("paymentdetails")) break;
				if (normalizeKey(value).includes("notes")) break;
				lines.push(value);
			}
			return lines;
		}
	}
	return [];
}

function findLineItems(rows: string[][]) {
	const headerRowIndex = rows.findIndex((row) => {
		const keys = row.map(normalizeKey);
		return (
			keys.some((key) =>
				headerMatches(key, ["description", "item", "service", "product"]),
			) &&
			keys.some((key) => headerMatches(key, ["qty", "quantity", "units"])) &&
			keys.some((key) =>
				headerMatches(key, ["price", "unitprice", "rate", "amount", "total"]),
			)
		);
	});
	if (headerRowIndex < 0) return [];

	const headers = rows[headerRowIndex]?.map(normalizeKey) ?? [];
	const findIndex = (names: string[]) =>
		headers.findIndex((header) => headerMatches(header, names));
	const descriptionIndex = findIndex([
		"description",
		"item",
		"service",
		"product",
	]);
	const quantityIndex = findIndex(["qty", "quantity", "units"]);
	const priceIndex = findIndex(["price", "unitprice", "rate"]);
	const amountIndex = findIndex(["amount", "total", "lineamount", "linetotal"]);

	const items: ImportedInvoiceDraft["lineItems"] = [];
	for (
		let rowIndex = headerRowIndex + 1;
		rowIndex < rows.length;
		rowIndex += 1
	) {
		const row = rows[rowIndex] ?? [];
		const joined = normalizeKey(row.join(" "));
		if (joined.includes("subtotal") || joined.includes("totaldue")) break;

		const name = row[descriptionIndex]?.trim() ?? "";
		const quantity = Math.max(1, parseMoney(row[quantityIndex]) || 1);
		const unitPrice = priceIndex >= 0 ? parseMoney(row[priceIndex]) : 0;
		const amount = amountIndex >= 0 ? parseMoney(row[amountIndex]) : 0;
		const price =
			unitPrice > 0 ? unitPrice : amount > 0 ? amount / quantity : 0;

		if (!name && price <= 0) {
			if (items.length > 0) break;
			continue;
		}
		if (!name || price <= 0) continue;
		items.push({ name, quantity, price });
	}

	return items;
}

function inferCurrency(rows: string[][]) {
	const text = rows.flat().join(" ").toUpperCase();
	if (text.includes("NGN") || text.includes("₦")) return "NGN";
	if (text.includes("USD") || text.includes("$")) return "USD";
	if (text.includes("GBP") || text.includes("£")) return "GBP";
	return undefined;
}

export function parseInvoiceDraftGrid(
	grid: unknown[][],
): ImportedInvoiceDraft | null {
	const rows = grid.map((row) => row.map(cellText));
	const lineItems = findLineItems(rows);
	if (lineItems.length === 0) return null;

	const billToLines = findSectionLines(rows, ["billto", "client", "customer"]);
	const customerName = billToLines.find((line) => !line.includes("@"));
	const customerEmail = billToLines.find((line) => /\S+@\S+\.\S+/.test(line));

	return {
		invoiceNumber: findLabelValue(rows, [
			"invoiceno",
			"invoicenumber",
			"invno",
		]),
		customerName,
		customerEmail,
		currency: inferCurrency(rows),
		status: parseInvoiceStatus(findLabelValue(rows, ["status"])),
		issueDate: normalizeDate(
			findLabelValue(rows, ["date", "issuedate", "invoicedate"]),
		),
		dueDate: normalizeDate(findLabelValue(rows, ["duedate"])),
		notes: findSectionLines(rows, ["notes"], 4).join("\n") || undefined,
		paymentDetails:
			findSectionLines(rows, ["paymentdetails"], 6).join("\n") || undefined,
		lineItems,
	};
}
