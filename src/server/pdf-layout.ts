import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
	PDFDocument,
	type PDFFont,
	type PDFImage,
	type PDFPage,
	type RGB,
	StandardFonts,
} from "pdf-lib";
import { getInvoicePaymentReference } from "#/lib/invoice-document/payment-reference";
import type {
	EditorDoc,
	EditorNode,
	Invoice,
	LineItem,
	Template,
} from "#/lib/invoice-document/types";
import {
	calculateLineItemTotal,
	calculateTotal,
} from "#/lib/invoice-document/utils/calculate";
import { isValidJSON } from "#/lib/invoice-document/utils/content";
import { formatAmount } from "#/shims/invoice-utils/format";
import {
	drawRule,
	drawText,
	fitText,
	measureText,
	PDF_INK,
	PDF_MUTED,
	PDF_RULE,
} from "./pdf/text";

/**
 * Vector invoice PDF, drawn with `pdf-lib`.
 *
 * The layout mirrors the customer-facing HTML preview's `print` appearance
 * (`src/lib/invoice-document/templates/html`) one-for-one at 1 pt per CSS px:
 * the same paper sizes, the same colours, the same blocks in the same order
 * (header + logo, From/To, top block, line-item table, totals hierarchy,
 * payment details + reference, note and bottom block), the same date and money
 * formatting, and the same "a draft has nothing to pay" rule.
 *
 * It runs on Cloudflare Workers: pure JavaScript, the built-in Helvetica
 * faces, no WASM, no font files and no filesystem. A rendering failure is
 * thrown to the caller — the download and email paths report it instead of
 * quietly substituting a plain-text document.
 */

const PAGE_SIZES = {
	a4: { width: 595.28, height: 841.89 },
	letter: { width: 612, height: 792 },
} as const;

/** `p-8` in the print appearance. */
const MARGIN = 32;
/** `gap-6` between the two-column blocks. */
const COLUMN_GAP = 24;
/** `--invoice-editor-size: 11px` with `leading-4` (16px). */
const BODY_SIZE = 11;
const BODY_LEADING = 16;
/** `mb-2` under a section label. */
const LABEL_GAP = 8;
/** `font-medium` title / net payable, replaced by the bold standard face. */
const TITLE_SIZE = 21;
const NET_SIZE = 15;
/** `w-[320px]` on the totals block. */
const SUMMARY_WIDTH = 320;
/** One `py-1` totals row. */
const SUMMARY_ROW = 19;
/** `gap-4` between line-item columns. */
const TABLE_GAP = 16;
const LOGO_MAX_HEIGHT = 80;
const LOGO_MAX_WIDTH = 300;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fonts = {
	regular: PDFFont;
	bold: PDFFont;
	italic: PDFFont;
	boldItalic: PDFFont;
};

type TextRun = {
	text: string;
	font: PDFFont;
	underline: boolean;
	strike: boolean;
};

type TextLine = { runs: TextRun[]; width: number };

type Word = TextRun & { hardBreak: boolean };

type Part = { text: string; font?: PDFFont; color?: RGB };

type PageSize = { width: number; height: number };

function blankLine(): TextLine {
	return { runs: [], width: 0 };
}

/** Flattens one paragraph into words that keep their inline marks. */
function paragraphWords(node: EditorNode, fonts: Fonts): Word[] {
	const words: Word[] = [];
	for (const inline of node.content ?? []) {
		if (inline.type === "hardBreak") {
			words.push({
				text: "",
				font: fonts.regular,
				underline: false,
				strike: false,
				hardBreak: true,
			});
			continue;
		}
		if (inline.type !== "text") continue;

		const text = inline.text ?? "";
		const marks = inline.marks ?? [];
		const bold = marks.some((mark) => mark.type === "bold");
		const italic = marks.some((mark) => mark.type === "italic");
		const linked =
			marks.some((mark) => mark.type === "link") || EMAIL.test(text);
		const strike = marks.some((mark) => mark.type === "strike");
		const font =
			bold && italic
				? fonts.boldItalic
				: bold
					? fonts.bold
					: italic
						? fonts.italic
						: fonts.regular;

		for (const chunk of text.split(/(\s+)/)) {
			if (chunk.length === 0) continue;
			words.push({
				text: chunk,
				font,
				underline: linked,
				strike,
				hardBreak: false,
			});
		}
	}
	return words;
}

function pushRun(line: TextLine, run: TextRun & { hardBreak?: boolean }) {
	const last = line.runs[line.runs.length - 1];
	if (
		last &&
		last.font === run.font &&
		last.underline === run.underline &&
		last.strike === run.strike
	) {
		last.text += run.text;
		return;
	}
	line.runs.push({ ...run });
}

/** Greedy word wrap to `maxWidth`, with hard wrapping for over-long words. */
function wrapWords(words: Word[], maxWidth: number, size: number): TextLine[] {
	const lines: TextLine[] = [];
	let line: TextLine = { runs: [], width: 0 };

	const flush = () => {
		const last = line.runs[line.runs.length - 1];
		if (last) {
			const trimmed = last.text.replace(/\s+$/, "");
			if (trimmed !== last.text) {
				line.width -=
					measureText(last.font, last.text, size) -
					measureText(last.font, trimmed, size);
				last.text = trimmed;
				if (trimmed.length === 0) line.runs.pop();
			}
		}
		lines.push(line);
		line = { runs: [], width: 0 };
	};

	for (const word of words) {
		if (word.hardBreak) {
			flush();
			continue;
		}

		const wordWidth = measureText(word.font, word.text, size);
		if (wordWidth > maxWidth) {
			let chunk = "";
			let chunkWidth = 0;
			for (const char of word.text) {
				const charWidth = measureText(word.font, char, size);
				if (chunkWidth > 0 && line.width + chunkWidth + charWidth > maxWidth) {
					pushRun(line, { ...word, text: chunk, hardBreak: false });
					line.width += chunkWidth;
					flush();
					chunk = "";
					chunkWidth = 0;
				}
				chunk += char;
				chunkWidth += charWidth;
			}
			if (chunk.length > 0) {
				pushRun(line, { ...word, text: chunk, hardBreak: false });
				line.width += chunkWidth;
			}
			continue;
		}

		// A space never starts a line, matching the browser's collapsing.
		if (chunkIsSpace(word.text) && line.runs.length === 0) continue;
		if (line.runs.length > 0 && line.width + wordWidth > maxWidth) flush();
		pushRun(line, { ...word, hardBreak: false });
		line.width += wordWidth;
	}

	if (line.runs.length > 0) flush();
	return lines;
}

function chunkIsSpace(text: string) {
	return /^\s+$/.test(text);
}

/** Wraps a rich-text block into drawable lines (blank lines included). */
function wrapRichText(
	doc: EditorDoc | null | undefined,
	width: number,
	fonts: Fonts,
	size = BODY_SIZE,
): TextLine[] {
	if (!doc?.content?.length) return [];
	const lines: TextLine[] = [];
	for (const node of doc.content) {
		if (node.type !== "paragraph") continue;
		const wrapped = wrapWords(paragraphWords(node, fonts), width, size);
		if (wrapped.length === 0) {
			lines.push(blankLine());
			continue;
		}
		lines.push(...wrapped);
	}
	return lines;
}

function wrapPlainText(
	text: string,
	width: number,
	font: PDFFont,
	size = BODY_SIZE,
): TextLine[] {
	const words: Word[] = text
		.split(/(\s+)/)
		.filter((chunk) => chunk.length > 0)
		.map((chunk) => ({
			text: chunk,
			font,
			underline: false,
			strike: false,
			hardBreak: false,
		}));
	return wrapWords(words, width, size);
}

class PdfLayout {
	readonly fonts: Fonts;
	readonly pageSize: PageSize;
	readonly contentWidth: number;
	private readonly pdf: PDFDocument;
	private page: PDFPage;
	private cursor: number;

	constructor(pdf: PDFDocument, fonts: Fonts, pageSize: PageSize) {
		this.pdf = pdf;
		this.fonts = fonts;
		this.pageSize = pageSize;
		this.contentWidth = pageSize.width - MARGIN * 2;
		this.page = pdf.addPage([pageSize.width, pageSize.height]);
		this.cursor = MARGIN;
	}

	/** Distance from the top of the page to the current line's top. */
	get top() {
		return this.cursor;
	}

	get bottom() {
		return this.pageSize.height - MARGIN;
	}

	get x() {
		return MARGIN;
	}

	get right() {
		return this.pageSize.width - MARGIN;
	}

	/** PDF-space y of the current line's top. */
	private get y() {
		return this.pageSize.height - this.cursor;
	}

	mark() {
		return this.cursor;
	}

	jumpTo(cursor: number) {
		this.cursor = Math.max(MARGIN, cursor);
	}

	newPage() {
		this.page = this.pdf.addPage([this.pageSize.width, this.pageSize.height]);
		this.cursor = MARGIN;
	}

	ensure(height: number) {
		if (this.cursor + height > this.bottom) this.newPage();
	}

	/** Adds `height`, unless the cursor is already at the top of a page. */
	spacer(height: number) {
		if (this.cursor > MARGIN) this.cursor += height;
	}

	advance(height: number) {
		this.cursor += height;
	}

	/** Baseline for a line of `size` with `leading`, at the current cursor. */
	private baseline(font: PDFFont, size: number, leading: number) {
		const ascent = font.heightAtSize(size, { descender: false });
		const full = font.heightAtSize(size);
		return this.y - Math.max(0, (leading - full) / 2) - ascent;
	}

	/** Draws styled parts on the current line without advancing the cursor. */
	stamp(
		parts: Part[],
		{
			x = this.x,
			size = BODY_SIZE,
			leading = BODY_LEADING,
			align = "left",
		}: {
			x?: number;
			size?: number;
			leading?: number;
			align?: "left" | "right";
		} = {},
	) {
		const font = parts[0]?.font ?? this.fonts.regular;
		const width = parts.reduce(
			(sum, part) => sum + measureText(part.font ?? font, part.text, size),
			0,
		);
		let cursorX = align === "right" ? this.right - width : x;
		const y = this.baseline(font, size, leading);
		for (const part of parts) {
			cursorX += drawText(this.page, part.text, {
				x: cursorX,
				y,
				font: part.font ?? font,
				size,
				color: part.color ?? PDF_INK,
			});
		}
	}

	/** Draws one line of styled parts and advances the cursor. */
	line(
		parts: Part[],
		options: {
			x?: number;
			size?: number;
			leading?: number;
			align?: "left" | "right";
		} = {},
	) {
		this.ensure(options.leading ?? BODY_LEADING);
		this.stamp(parts, options);
		this.advance(options.leading ?? BODY_LEADING);
	}

	rule({
		x = this.x,
		width = this.contentWidth,
		color = PDF_RULE,
		thickness = 0.75,
		offset = 0,
	}: {
		x?: number;
		width?: number;
		color?: RGB;
		thickness?: number;
		offset?: number;
	} = {}) {
		drawRule(this.page, {
			x,
			y: this.y - offset,
			width,
			color,
			thickness,
		});
	}

	image(
		image: PDFImage,
		{ x, height, width }: { x: number; height: number; width: number },
	) {
		this.page.drawImage(image, { x, y: this.y - height, width, height });
	}

	/** Draws wrapped rich-text lines, starting a new page when one would clip. */
	drawWrapped(
		lines: TextLine[],
		{
			x = this.x,
			size = BODY_SIZE,
			leading = BODY_LEADING,
			color = PDF_INK,
			align = "left",
		}: {
			x?: number;
			size?: number;
			leading?: number;
			color?: RGB;
			align?: "left" | "right";
		} = {},
	) {
		for (const line of lines) {
			this.ensure(leading);
			const y = this.baseline(this.fonts.regular, size, leading);
			let cursorX = align === "right" ? this.right - line.width : x;
			for (const run of line.runs) {
				const width = drawText(this.page, run.text, {
					x: cursorX,
					y,
					font: run.font,
					size,
					color,
				});
				if (run.underline) {
					drawRule(this.page, {
						x: cursorX,
						y: y - size * 0.12,
						width,
						color,
						thickness: 0.5,
					});
				}
				if (run.strike) {
					drawRule(this.page, {
						x: cursorX,
						y: y + size * 0.26,
						width,
						color,
						thickness: 0.5,
					});
				}
				cursorX += width;
			}
			this.advance(leading);
		}
	}
}

function formatDocDate(value: string | null, template: Template) {
	if (!value) return "";
	try {
		return format(new TZDate(value, template.timezone), template.dateFormat);
	} catch {
		return "";
	}
}

function amount(
	value: number,
	template: Template,
	maximumFractionDigits = template.includeDecimals ? 2 : 0,
) {
	return formatAmount({
		amount: value,
		currency: template.currency,
		locale: template.locale,
		maximumFractionDigits,
		currencyDisplay: template.currency === "NGN" ? "symbol" : "code",
	});
}

function base64ToBytes(value: string) {
	const binary = atob(value.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/** Embeds the workspace logo from its data URL; unsupported logos are skipped. */
async function embedLogo(pdf: PDFDocument, logoUrl: string | null) {
	if (!logoUrl) return null;
	try {
		const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(logoUrl.trim());
		if (!match) return null;
		const bytes = base64ToBytes(match[2] ?? "");
		return /png/i.test(match[1] ?? "")
			? await pdf.embedPng(bytes)
			: await pdf.embedJpg(bytes);
	} catch {
		return null;
	}
}

function drawHeader(layout: PdfLayout, doc: Invoice, logo: PDFImage | null) {
	const { template } = doc;
	const { fonts } = layout;
	const rows: Array<[string, string]> = [
		[`${template.invoiceNoLabel}:`, doc.invoiceNumber ?? ""],
	];
	if (doc.customerPoNumber) rows.push(["Customer PO:", doc.customerPoNumber]);
	rows.push([
		`${template.issueDateLabel}:`,
		formatDocDate(doc.issueDate, template),
	]);
	rows.push([
		`${template.dueDateLabel}:`,
		formatDocDate(doc.dueDate, template),
	]);

	const logoScale = logo
		? Math.min(LOGO_MAX_HEIGHT / logo.height, LOGO_MAX_WIDTH / logo.width, 1)
		: 0;
	const logoWidth = logo ? logo.width * logoScale : 0;
	const logoHeight = logo ? logo.height * logoScale : 0;

	if (logo) {
		layout.image(logo, {
			x: layout.right - logoWidth,
			height: logoHeight,
			width: logoWidth,
		});
	}

	const metaWidth = Math.max(
		100,
		layout.contentWidth - (logoWidth > 0 ? logoWidth + COLUMN_GAP : 0),
	);

	layout.line([{ text: template.title, font: fonts.bold }], {
		size: TITLE_SIZE,
		leading: 26,
	});
	layout.advance(4);

	for (const [label, value] of rows) {
		layout.ensure(BODY_LEADING);
		const labelWidth = measureText(fonts.regular, label, BODY_SIZE);
		const valueRoom = Math.max(BODY_SIZE, metaWidth - labelWidth - 8);
		layout.stamp([
			{ text: label, color: PDF_MUTED },
			{ text: " " },
			{
				text: fitText(fonts.regular, value, BODY_SIZE, valueRoom),
			},
		]);
		layout.advance(BODY_LEADING);
		layout.advance(2);
	}

	layout.jumpTo(Math.max(layout.top, MARGIN + logoHeight));
}

function drawLabeledBlock(
	layout: PdfLayout,
	label: string,
	lines: TextLine[],
	x: number,
) {
	layout.line([{ text: label, color: PDF_MUTED }], { x });
	layout.advance(LABEL_GAP);
	layout.drawWrapped(lines, { x });
}

function drawParties(layout: PdfLayout, doc: Invoice) {
	const columnWidth = (layout.contentWidth - COLUMN_GAP) / 2;
	const fromLines = wrapRichText(doc.fromDetails, columnWidth, layout.fonts);
	const toLines = wrapRichText(doc.customerDetails, columnWidth, layout.fonts);
	const height =
		BODY_LEADING +
		LABEL_GAP +
		Math.max(fromLines.length, toLines.length) * BODY_LEADING;

	layout.spacer(24);
	layout.ensure(height);

	const mark = layout.mark();
	drawLabeledBlock(layout, doc.template.fromLabel, fromLines, layout.x);
	const leftBottom = layout.top;

	layout.jumpTo(mark);
	drawLabeledBlock(
		layout,
		doc.template.customerLabel,
		toLines,
		layout.x + columnWidth + COLUMN_GAP,
	);
	layout.jumpTo(Math.max(leftBottom, layout.top));
	layout.spacer(16);
}

function drawTopBlock(layout: PdfLayout, doc: Invoice) {
	const lines = wrapRichText(doc.topBlock, layout.contentWidth, layout.fonts);
	if (lines.length === 0) return;
	layout.drawWrapped(lines);
	layout.spacer(16);
}

function lineItemDescription(
	layout: PdfLayout,
	item: LineItem,
	width: number,
): TextLine[] {
	const name = item.name ?? "";
	if (isValidJSON(name)) {
		const parsed = JSON.parse(name) as EditorDoc | null;
		if (parsed && typeof parsed === "object" && Array.isArray(parsed.content)) {
			const lines = wrapRichText(parsed, width, layout.fonts);
			if (lines.length > 0) return lines;
		}
	}
	const lines = wrapPlainText(name, width, layout.fonts.regular);
	return lines.length > 0 ? lines : [blankLine()];
}

function drawLineItems(layout: PdfLayout, doc: Invoice) {
	const { template } = doc;
	const valueColumn = layout.contentWidth * 0.15;
	const descriptionColumn =
		layout.contentWidth - valueColumn * 3 - TABLE_GAP * 3;
	const columns = {
		description: layout.x,
		quantity: layout.x + descriptionColumn + TABLE_GAP,
		price: layout.x + descriptionColumn + valueColumn + TABLE_GAP * 2,
		total: layout.right - valueColumn,
	};

	const drawHeader = () => {
		layout.ensure(BODY_LEADING + 16);
		layout.stamp([{ text: template.descriptionLabel, color: PDF_MUTED }], {
			x: columns.description,
		});
		layout.stamp([{ text: template.quantityLabel, color: PDF_MUTED }], {
			x: columns.quantity,
		});
		layout.stamp([{ text: template.priceLabel, color: PDF_MUTED }], {
			x: columns.price,
		});
		layout.stamp([{ text: template.totalLabel, color: PDF_MUTED }], {
			x: columns.total,
			align: "right",
		});
		layout.advance(BODY_LEADING);
		layout.rule({ offset: LABEL_GAP });
		layout.advance(LABEL_GAP * 2);
	};

	layout.spacer(20);
	drawHeader();

	for (const item of doc.lineItems) {
		const description = lineItemDescription(layout, item, descriptionColumn);
		const rowHeight = description.length * BODY_LEADING + 12;
		if (layout.top + rowHeight > layout.bottom && layout.top > MARGIN) {
			layout.newPage();
			drawHeader();
		}

		layout.advance(4);
		const rowTop = layout.mark();
		layout.drawWrapped(description, { x: columns.description });
		const rowBottom = layout.top;

		layout.jumpTo(rowTop);
		layout.stamp([{ text: String(item.quantity ?? 0) }], {
			x: columns.quantity,
		});
		const price = amount(item.price ?? 0, template);
		layout.stamp(
			[
				{
					text:
						template.includeUnits && item.unit
							? `${price}/${item.unit}`
							: price,
				},
			],
			{ x: columns.price },
		);
		layout.stamp(
			[
				{
					text: amount(
						calculateLineItemTotal({
							price: item.price,
							quantity: item.quantity,
						}),
						template,
					),
				},
			],
			{ x: columns.total, align: "right" },
		);

		layout.jumpTo(rowBottom);
		layout.advance(8);
	}
}

function drawSummary(layout: PdfLayout, doc: Invoice) {
	const { template } = doc;
	const { subTotal, total, vat, tax } = calculateTotal({
		lineItems: doc.lineItems,
		taxRate: template.taxRate,
		vatRate: template.vatRate,
		discount: doc.discount ?? 0,
		discountMode: template.discountMode,
		includeVat: template.includeVat,
		includeTax: template.includeTax,
	});
	const displayTotal = doc.amount ?? total;
	const withholdingTaxAmount = doc.withholdingTax ?? 0;
	const netPayable = doc.netPayable ?? displayTotal;
	const baseFractionDigits = template.includeDecimals ? 2 : 0;

	type Row = { label: string; value: string; kind: "row" | "total" | "net" };
	const rows: Row[] = [
		{
			label: template.subtotalLabel,
			value: amount(subTotal, template, baseFractionDigits),
			kind: "row",
		},
	];
	if (template.includeDiscount) {
		rows.push({
			label: template.discountLabel,
			value: amount(doc.discount ?? 0, template, baseFractionDigits),
			kind: "row",
		});
	}
	if (template.includeVat) {
		rows.push({
			label: `${template.vatLabel} (${template.vatRate}%)`,
			value: amount(vat, template, 2),
			kind: "row",
		});
	}
	if (template.includeTax) {
		rows.push({
			label: `${template.taxLabel} (${template.taxRate}%)`,
			value: amount(tax, template, 2),
			kind: "row",
		});
	}
	if (withholdingTaxAmount > 0) {
		rows.push({
			label: `${template.withholdingTaxLabel} (${template.withholdingTaxRate ?? 0}%)`,
			value: amount(-withholdingTaxAmount, template, 2),
			kind: "row",
		});
	}
	rows.push({
		label: template.totalSummaryLabel,
		value: amount(
			displayTotal,
			template,
			template.includeTax || template.includeVat ? 2 : baseFractionDigits,
		),
		kind: "total",
	});
	if (netPayable !== displayTotal) {
		rows.push({
			label: template.netAmountLabel,
			value: amount(netPayable, template, 2),
			kind: "net",
		});
	}

	const height = rows.reduce(
		(sum, row) =>
			sum + (row.kind === "total" ? 58 : row.kind === "net" ? 24 : SUMMARY_ROW),
		0,
	);

	layout.spacer(40);
	layout.ensure(height + 24);
	const x = layout.right - SUMMARY_WIDTH;

	for (const row of rows) {
		if (row.kind === "row") {
			layout.stamp([{ text: row.label, color: PDF_MUTED }], { x });
			layout.stamp([{ text: row.value, color: PDF_MUTED }], {
				x: layout.right,
				align: "right",
			});
			layout.advance(SUMMARY_ROW);
			continue;
		}

		if (row.kind === "total") {
			layout.advance(8);
			layout.rule({ x, width: SUMMARY_WIDTH });
			layout.advance(16);
			layout.stamp([{ text: row.label, color: PDF_MUTED }], {
				x,
				leading: 26,
			});
			layout.stamp([{ text: row.value }], {
				x: layout.right,
				size: TITLE_SIZE,
				leading: 26,
				align: "right",
			});
			layout.advance(26);
			layout.advance(16);
			continue;
		}

		layout.stamp([{ text: row.label, color: PDF_MUTED }], { x, leading: 20 });
		layout.stamp([{ text: row.value, font: layout.fonts.bold }], {
			x: layout.right,
			size: NET_SIZE,
			leading: 20,
			align: "right",
		});
		layout.advance(20);
		layout.advance(4);
	}

	layout.spacer(24);
}

function drawFooter(layout: PdfLayout, doc: Invoice) {
	const { template } = doc;
	const columnWidth = (layout.contentWidth - COLUMN_GAP) / 2;
	const showPayment = doc.status !== "draft";
	const reference = showPayment ? getInvoicePaymentReference(doc) : null;
	const paymentLines = showPayment
		? wrapRichText(doc.paymentDetails, columnWidth, layout.fonts)
		: [];
	const noteLines = doc.noteDetails
		? wrapRichText(doc.noteDetails, columnWidth, layout.fonts)
		: [];
	const paymentHeight =
		paymentLines.length > 0
			? BODY_LEADING +
				LABEL_GAP +
				paymentLines.length * BODY_LEADING +
				(reference ? 4 + BODY_LEADING : 0)
			: 0;
	const noteHeight =
		noteLines.length > 0
			? BODY_LEADING + LABEL_GAP + noteLines.length * BODY_LEADING
			: 0;
	const columnsHeight = Math.max(paymentHeight, noteHeight);
	const bottomLines = wrapRichText(
		doc.bottomBlock,
		layout.contentWidth,
		layout.fonts,
	);
	const bottomHeight =
		bottomLines.length > 0 ? 24 + bottomLines.length * BODY_LEADING : 0;
	const footerHeight = columnsHeight + bottomHeight;
	if (footerHeight === 0) return;

	// The preview pushes this block to the bottom of the sheet (`mt-auto`), so
	// anchor it there when there is room and only flow from the top otherwise.
	const start = Math.max(layout.top + 24, layout.bottom - footerHeight);
	if (start + footerHeight <= layout.bottom) {
		layout.jumpTo(start);
	} else {
		layout.ensure(footerHeight);
	}

	const mark = layout.mark();
	if (paymentLines.length > 0) {
		layout.line([{ text: template.paymentLabel, color: PDF_MUTED }], {
			x: layout.x,
		});
		layout.advance(LABEL_GAP);
		layout.drawWrapped(paymentLines, { x: layout.x });
		if (reference) {
			layout.advance(4);
			const labelWidth = measureText(
				layout.fonts.regular,
				`${reference.label}: `,
				BODY_SIZE,
			);
			layout.ensure(BODY_LEADING);
			layout.stamp([{ text: `${reference.label}: `, color: PDF_MUTED }], {
				x: layout.x,
			});
			layout.stamp([{ text: reference.value, font: layout.fonts.bold }], {
				x: layout.x + labelWidth,
			});
			layout.advance(BODY_LEADING);
		}
	}

	layout.jumpTo(mark);
	if (noteLines.length > 0) {
		drawLabeledBlock(
			layout,
			template.noteLabel,
			noteLines,
			layout.x + columnWidth + COLUMN_GAP,
		);
	}

	layout.jumpTo(mark + columnsHeight);
	if (bottomLines.length > 0) {
		layout.advance(24);
		layout.drawWrapped(bottomLines);
	}
}

export async function renderInvoicePdfDocument(
	doc: Invoice,
): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const fonts: Fonts = {
		regular: await pdf.embedFont(StandardFonts.Helvetica),
		bold: await pdf.embedFont(StandardFonts.HelveticaBold),
		italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
		boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
	};
	const pageSize = PAGE_SIZES[doc.template.size] ?? PAGE_SIZES.a4;
	const layout = new PdfLayout(pdf, fonts, pageSize);
	const logo = await embedLogo(pdf, doc.template.logoUrl);

	drawHeader(layout, doc, logo);
	drawParties(layout, doc);
	drawTopBlock(layout, doc);
	drawLineItems(layout, doc);
	drawSummary(layout, doc);
	drawFooter(layout, doc);

	return pdf.save();
}
