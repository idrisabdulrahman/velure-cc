/**
 * Business-logo intake for the workspace settings form.
 *
 * The HTML preview and the vector PDF share one stored logo, but they can
 * decode different formats: the browser renders PNG, JPEG and WebP, while the
 * PDF embeds only PNG and JPEG (`src/server/pdf-layout.ts`). Accepting a WebP
 * and storing it unchanged therefore shows the logo on screen and silently
 * drops it from the downloaded invoice.
 *
 * `normalizeLogoFile` closes that gap: it validates the selection against the
 * accepted image types and size, passes PNG/JPEG through byte-for-byte, and
 * re-encodes anything else (WebP today) to PNG in the browser so the stored
 * data URL is always embeddable.
 */

export const LOGO_ACCEPTED_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;

/** `accept` attribute for the file input, kept in step with the validation. */
export const LOGO_ACCEPT_ATTRIBUTE = LOGO_ACCEPTED_MIME_TYPES.join(",");

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Longest-edge cap for a re-encoded logo, keeping the stored data URL small. */
export const LOGO_MAX_DIMENSION = 1024;

export type LogoUploadErrorCode =
	| "unsupported-type"
	| "too-large"
	| "unreadable";

export class LogoUploadError extends Error {
	readonly code: LogoUploadErrorCode;

	constructor(code: LogoUploadErrorCode) {
		super(code);
		this.name = "LogoUploadError";
		this.code = code;
	}
}

const ERROR_MESSAGES: Record<LogoUploadErrorCode, string> = {
	"unsupported-type": "Logo must be a PNG, JPEG, or WebP image.",
	"too-large": "Logo must be 2MB or smaller.",
	unreadable: "That image could not be read. Try a different file.",
};

export function logoUploadErrorMessage(error: unknown): string {
	if (error instanceof LogoUploadError) return ERROR_MESSAGES[error.code];
	return ERROR_MESSAGES.unreadable;
}

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") resolve(reader.result);
			else reject(new LogoUploadError("unreadable"));
		};
		reader.onerror = () => reject(new LogoUploadError("unreadable"));
		reader.readAsDataURL(file);
	});
}

function readAsBytes(file: File): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				resolve(new Uint8Array(reader.result));
			} else {
				reject(new LogoUploadError("unreadable"));
			}
		};
		reader.onerror = () => reject(new LogoUploadError("unreadable"));
		reader.readAsArrayBuffer(file);
	});
}

function loadImage(source: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new LogoUploadError("unreadable"));
		image.src = source;
	});
}

/** Re-encodes a non-PNG/JPEG data URL to PNG at a bounded size. */
async function reencodeToPng(source: string): Promise<string> {
	const image = await loadImage(source);
	const sourceWidth = image.naturalWidth || image.width;
	const sourceHeight = image.naturalHeight || image.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) {
		throw new LogoUploadError("unreadable");
	}
	const scale = Math.min(
		1,
		LOGO_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
	);
	const width = Math.max(1, Math.round(sourceWidth * scale));
	const height = Math.max(1, Math.round(sourceHeight * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new LogoUploadError("unreadable");
	context.drawImage(image, 0, 0, width, height);
	const result = canvas.toDataURL("image/png");
	if (!result.startsWith("data:image/png")) {
		throw new LogoUploadError("unreadable");
	}
	return result;
}

/** The real format of an image, from its magic bytes (not the file name). */
type SniffedFormat = "png" | "jpeg" | "webp";

function sniffImageFormat(bytes: Uint8Array): SniffedFormat | null {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "png";
	}
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "jpeg";
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 && // R
		bytes[1] === 0x49 && // I
		bytes[2] === 0x46 && // F
		bytes[3] === 0x46 && // F
		bytes[8] === 0x57 && // W
		bytes[9] === 0x45 && // E
		bytes[10] === 0x42 && // B
		bytes[11] === 0x50 // P
	) {
		return "webp";
	}
	return null;
}

/**
 * Validates a selected logo file and returns a data URL the PDF can embed.
 * The real format is sniffed from the bytes, because the browser-declared MIME
 * type can lie (a WebP renamed `.png` would otherwise be stored and then
 * silently dropped by the PDF embedder). PNG/JPEG bytes are kept as-is; WebP
 * is re-encoded to PNG. Throws a `LogoUploadError` for a non-image, an
 * oversized file, or an image the browser cannot decode.
 */
export async function normalizeLogoFile(file: File): Promise<string> {
	if (file.size > LOGO_MAX_BYTES) {
		throw new LogoUploadError("too-large");
	}
	const bytes = await readAsBytes(file);
	const format = sniffImageFormat(bytes);
	if (format === null) {
		throw new LogoUploadError("unsupported-type");
	}
	// The base64 payload is format-independent, so reuse the reader's encoding
	// and rewrite the media type to the sniffed one.
	const read = await readAsDataUrl(file);
	const base64 = read.slice(read.indexOf(",") + 1);
	if (format === "webp") {
		return reencodeToPng(`data:image/webp;base64,${base64}`);
	}
	return `data:image/${format === "jpeg" ? "jpeg" : "png"};base64,${base64}`;
}
