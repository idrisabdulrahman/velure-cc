import {
	PDFDict,
	type PDFFont,
	PDFHexString,
	PDFName,
	PDFOperator,
	PDFOperatorNames,
	type PDFPage,
	type RGB,
	rgb,
} from "pdf-lib";

/**
 * Text primitives for the invoice PDF.
 *
 * The document is drawn with the standard Helvetica faces, which encode text
 * as WinAnsi. The Naira sign (`₦`, U+20A6) sits outside WinAnsi, so
 * `drawText` can never write it — and every NGN invoice in this product prints
 * amounts with that sign. It is therefore drawn from the outline of the same
 * Inter glyph the web preview falls back to, wrapped in an `/ActualText`
 * marked-content sequence so the sign is still declared as document text for
 * extractors that honour it.
 *
 * Any other character the face cannot encode is replaced with `?` instead of
 * letting `drawText` throw, so one stray character in a customer's note cannot
 * take the whole download down.
 */

export const NAIRA_SIGN = "\u20A6";

/** `--invoice-text` / `--invoice-muted` / `--invoice-rule` from the print preview. */
export const PDF_INK = rgb(0x11 / 255, 0x13 / 255, 0x19 / 255);
export const PDF_MUTED = rgb(0x81 / 255, 0x7d / 255, 0x72 / 255);
export const PDF_RULE = rgb(0xd7 / 255, 0xdc / 255, 0xe6 / 255);

type NairaWeight = "regular" | "medium";

/**
 * Inter's Naira outline (U+20A6), normalised to a 1 em box in SVG coordinates
 * (x to the right, y upwards from the baseline, so the sign is negative).
 * `drawSvgPath` flips SVG's y axis, so the sign is drawn by calling it at the
 * text baseline with `scale: fontSize`.
 */
const NAIRA_OUTLINES: Record<NairaWeight, string> = {
	regular:
		"M 0.747 -0.462 L 0.747 -0.391 L 0.022 -0.391 L 0.022 -0.462 Z " +
		"M 0.747 -0.309 L 0.747 -0.237 L 0.022 -0.237 L 0.022 -0.309 Z " +
		"M 0.097 0 L 0.097 -0.728 L 0.206 -0.728 L 0.502 -0.262 " +
		"Q 0.514 -0.244 0.53 -0.216 Q 0.547 -0.187 0.566 -0.152 " +
		"Q 0.585 -0.116 0.604 -0.076 L 0.591 -0.076 " +
		"Q 0.586 -0.118 0.584 -0.156 Q 0.583 -0.194 0.582 -0.227 " +
		"Q 0.582 -0.259 0.582 -0.281 L 0.582 -0.728 L 0.674 -0.728 L 0.674 0 " +
		"L 0.564 0 L 0.3 -0.414 Q 0.282 -0.443 0.264 -0.473 " +
		"Q 0.246 -0.504 0.222 -0.546 Q 0.199 -0.587 0.164 -0.649 " +
		"L 0.181 -0.649 Q 0.184 -0.595 0.186 -0.549 " +
		"Q 0.188 -0.503 0.189 -0.469 Q 0.19 -0.435 0.19 -0.415 L 0.19 0 Z ",
	medium:
		"M 0.745 -0.462 L 0.745 -0.391 L 0.021 -0.391 L 0.021 -0.462 Z " +
		"M 0.745 -0.309 L 0.745 -0.237 L 0.021 -0.237 L 0.021 -0.309 Z " +
		"M 0.09 0 L 0.09 -0.728 L 0.218 -0.728 L 0.492 -0.294 " +
		"Q 0.506 -0.273 0.523 -0.243 Q 0.54 -0.213 0.559 -0.176 " +
		"Q 0.578 -0.139 0.597 -0.095 L 0.583 -0.095 " +
		"Q 0.579 -0.136 0.577 -0.177 Q 0.575 -0.218 0.574 -0.253 " +
		"Q 0.573 -0.289 0.573 -0.313 L 0.573 -0.728 L 0.685 -0.728 L 0.685 0 " +
		"L 0.556 0 L 0.311 -0.387 Q 0.291 -0.419 0.272 -0.451 " +
		"Q 0.253 -0.483 0.231 -0.526 Q 0.208 -0.568 0.175 -0.628 " +
		"L 0.193 -0.628 Q 0.196 -0.575 0.198 -0.528 Q 0.2 -0.481 0.202 -0.446 " +
		"Q 0.203 -0.41 0.203 -0.388 L 0.203 0 Z ",
};

const NAIRA_ADVANCE_EM: Record<NairaWeight, number> = {
	regular: 0.76953125,
	medium: 0.765625,
};

const encodable = new Map<string, boolean>();

/**
 * pdf-lib's operator argument union omits `PDFDict`, though the operator
 * serializer writes any `PDFObject`. A marked-content property list is a dict,
 * so widen the type once, here.
 */
type OperatorArg = NonNullable<Parameters<typeof PDFOperator.of>[1]>[number];

function isEncodable(font: PDFFont, char: string) {
	const key = `${font.name} ${char}`;
	const cached = encodable.get(key);
	if (cached !== undefined) return cached;
	let supported = true;
	try {
		font.encodeText(char);
	} catch {
		supported = false;
	}
	encodable.set(key, supported);
	return supported;
}

/**
 * Whether the whole run can be written in the face as-is. One `encodeText`
 * call is far cheaper than testing every character, and it is the common case,
 * so it keeps measurement off the per-character slow path.
 */
function encodesWhole(font: PDFFont, text: string) {
	if (text.length === 0) return true;
	try {
		font.encodeText(text);
		return true;
	} catch {
		return false;
	}
}

/** Writes only characters the (WinAnsi) face can actually encode. */
function writeable(font: PDFFont, char: string) {
	if (char === "\t") return "  ";
	return isEncodable(font, char) ? char : "?";
}

function nairaWeight(font: PDFFont): NairaWeight {
	return /bold/i.test(font.name) ? "medium" : "regular";
}

/** Width of `text` in the given face, counting the drawn Naira sign. */
export function measureText(font: PDFFont, text: string, size: number) {
	if (text.indexOf(NAIRA_SIGN) === -1 && encodesWhole(font, text)) {
		return font.widthOfTextAtSize(text, size);
	}

	let width = 0;
	for (const char of text) {
		if (char === NAIRA_SIGN) {
			width += NAIRA_ADVANCE_EM[nairaWeight(font)] * size;
			continue;
		}
		width += font.widthOfTextAtSize(writeable(font, char), size);
	}
	return width;
}

/** `text` reduced to characters `font` can encode (Naira sign excluded). */
export function writeableText(font: PDFFont, text: string) {
	if (text.indexOf(NAIRA_SIGN) === -1 && encodesWhole(font, text)) return text;
	let out = "";
	for (const char of text) {
		if (char === NAIRA_SIGN) continue;
		out += writeable(font, char);
	}
	return out;
}

function drawNairaSign(
	page: PDFPage,
	x: number,
	y: number,
	size: number,
	color: RGB,
	font: PDFFont,
) {
	const weight = nairaWeight(font);
	const properties = PDFDict.withContext(page.doc.context);
	properties.set(PDFName.of("ActualText"), PDFHexString.fromText(NAIRA_SIGN));
	page.pushOperators(
		PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
			PDFName.of("Span"),
			properties as unknown as OperatorArg,
		]),
	);
	page.drawSvgPath(NAIRA_OUTLINES[weight], { x, y, scale: size, color });
	page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent, []));
}

type DrawTextOptions = {
	x: number;
	y: number;
	font: PDFFont;
	size: number;
	color: RGB;
};

/** Draws one line of text (with the Naira sign as a real glyph) and returns its width. */
export function drawText(
	page: PDFPage,
	text: string,
	{ x, y, font, size, color }: DrawTextOptions,
) {
	if (text.indexOf(NAIRA_SIGN) === -1) {
		const out = writeableText(font, text);
		if (out.length > 0) page.drawText(out, { x, y, size, font, color });
		return font.widthOfTextAtSize(out, size);
	}

	let cursor = x;
	const advance = NAIRA_ADVANCE_EM[nairaWeight(font)] * size;
	const segments = text.split(NAIRA_SIGN);
	for (let index = 0; index < segments.length; index++) {
		if (index > 0) {
			drawNairaSign(page, cursor, y, size, color, font);
			cursor += advance;
		}
		const out = writeableText(font, segments[index] ?? "");
		if (out.length > 0) {
			page.drawText(out, { x: cursor, y, size, font, color });
			cursor += font.widthOfTextAtSize(out, size);
		}
	}

	return cursor - x;
}

export function drawRule(
	page: PDFPage,
	{
		x,
		y,
		width,
		color = PDF_RULE,
		thickness = 0.75,
	}: { x: number; y: number; width: number; color?: RGB; thickness?: number },
) {
	page.drawLine({
		start: { x, y },
		end: { x: x + width, y },
		thickness,
		color,
	});
}

/**
 * Truncates `text` to `maxWidth`, replacing the last characters with an
 * ellipsis, so a long meta or table value cannot run over its column.
 */
export function fitText(
	font: PDFFont,
	text: string,
	size: number,
	maxWidth: number,
) {
	if (measureText(font, text, size) <= maxWidth) return text;

	const ellipsis = "\u2026";
	const characters = Array.from(text);
	while (characters.length > 0) {
		characters.pop();
		const candidate = `${characters.join("")}${ellipsis}`;
		if (measureText(font, candidate, size) <= maxWidth) return candidate;
	}
	return "";
}
