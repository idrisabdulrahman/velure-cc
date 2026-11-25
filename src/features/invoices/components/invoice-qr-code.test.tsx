// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const toDataURL = vi.fn(
	async (value: string) => `data:image/png;base64,${value}`,
);

vi.mock("qrcode", () => ({
	default: { toDataURL: (value: string) => toDataURL(value) },
}));

import { InvoiceQrCode } from "./invoice-qr-code";

afterEach(() => {
	document.body.innerHTML = "";
	toDataURL.mockClear();
});

async function render(value: string) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<InvoiceQrCode value={value} label="QR code for invoice TEST-1" />,
		);
	});
	return { container, root };
}

describe("InvoiceQrCode", () => {
	it("encodes the value it was given and renders it as an image", async () => {
		const { container, root } = await render("https://invoicly.cv/i/token-a");

		const image = container.querySelector("img");
		expect(toDataURL).toHaveBeenCalledWith("https://invoicly.cv/i/token-a");
		expect(image?.getAttribute("src")).toBe(
			"data:image/png;base64,https://invoicly.cv/i/token-a",
		);
		expect(image?.getAttribute("alt")).toBe("QR code for invoice TEST-1");

		await act(async () => root.unmount());
	});

	it("gives every invoice a different code", async () => {
		const first = await render("https://invoicly.cv/i/token-a");
		const second = await render("https://invoicly.cv/i/token-b");

		const firstSrc = first.container.querySelector("img")?.getAttribute("src");
		const secondSrc = second.container
			.querySelector("img")
			?.getAttribute("src");
		expect(firstSrc).not.toBe(secondSrc);

		await act(async () => first.root.unmount());
		await act(async () => second.root.unmount());
	});

	it("stays silent when the encoder is unavailable", async () => {
		toDataURL.mockRejectedValueOnce(new Error("canvas unavailable"));
		const { container, root } = await render("https://invoicly.cv/i/token-a");

		expect(container.querySelector("img")).toBeNull();

		await act(async () => root.unmount());
	});
});
