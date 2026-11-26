// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	LogoUploadError,
	logoUploadErrorMessage,
	normalizeLogoFile,
} from "./logo-upload";

/**
 * The stored workspace logo feeds both the HTML preview and the vector PDF.
 * These checks pin the intake rules that keep the two in step: only accepted
 * image types, a bounded size, and a data URL the PDF renderer can embed
 * (PNG or JPEG) — WebP is re-encoded rather than stored as-is and silently
 * dropped from the download.
 */

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0];
const WEBP_BYTES = [
	0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0,
];
const GIF_BYTES = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0];

function file(type: string, bytes: readonly number[] = PNG_BYTES): File {
	return new File([new Uint8Array(bytes)], "logo", { type });
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("normalizeLogoFile", () => {
	it("rejects bytes that are not an accepted image, whatever the MIME says", async () => {
		await expect(
			normalizeLogoFile(file("image/gif", GIF_BYTES)),
		).rejects.toMatchObject({ code: "unsupported-type" });
		// A PNG MIME over non-image bytes is still rejected.
		await expect(
			normalizeLogoFile(file("image/png", GIF_BYTES)),
		).rejects.toBeInstanceOf(LogoUploadError);
	});

	it("accepts a real image even with an empty MIME type", async () => {
		const result = await normalizeLogoFile(file(""));
		expect(result.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("rejects a file over the size cap", async () => {
		const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo", {
			type: "image/png",
		});
		await expect(normalizeLogoFile(big)).rejects.toMatchObject({
			code: "too-large",
		});
	});

	it("passes a PNG through unchanged so the original bytes are kept", async () => {
		const result = await normalizeLogoFile(file("image/png"));
		expect(result.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("passes a JPEG through unchanged", async () => {
		const result = await normalizeLogoFile(file("image/jpeg", JPEG_BYTES));
		expect(result.startsWith("data:image/jpeg;base64,")).toBe(true);
	});

	it("re-encodes a WebP to PNG so the PDF can embed it", async () => {
		class FakeImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			naturalWidth = 1200;
			naturalHeight = 600;
			width = 1200;
			height = 600;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		}
		vi.stubGlobal("Image", FakeImage);
		const toDataURL = vi
			.spyOn(HTMLCanvasElement.prototype, "toDataURL")
			.mockReturnValue("data:image/png;base64,QUJD");
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);

		const result = await normalizeLogoFile(file("image/webp", WEBP_BYTES));
		expect(result).toBe("data:image/png;base64,QUJD");
		expect(toDataURL).toHaveBeenCalledWith("image/png");
	});

	it("re-encodes a WebP that was renamed to a PNG", async () => {
		// The MIME type lies; the magic bytes must win so the PDF still embeds it.
		class FakeImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			naturalWidth = 200;
			naturalHeight = 200;
			width = 200;
			height = 200;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		}
		vi.stubGlobal("Image", FakeImage);
		vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
			"data:image/png;base64,RE5G",
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);

		const result = await normalizeLogoFile(file("image/png", WEBP_BYTES));
		expect(result).toBe("data:image/png;base64,RE5G");
	});

	it("reports a readable message per failure code", () => {
		expect(logoUploadErrorMessage(new LogoUploadError("too-large"))).toContain(
			"2MB",
		);
		expect(
			logoUploadErrorMessage(new LogoUploadError("unsupported-type")),
		).toContain("PNG");
		expect(logoUploadErrorMessage(new Error("boom"))).toContain("could not");
	});
});
