/**
 * Cloudflare Worker build stub for the `qrcode` Node entry.
 *
 * The success-panel QR is generated in the browser (`InvoiceQrCode` imports the
 * encoder inside an effect). The Node entry of the same package pulls `fs` and
 * `pngjs` at module scope, which has no place in the Worker bundle: it would
 * ship Node-only code for a code path that never runs there.
 *
 * `vite.config.ts` aliases `qrcode` to this module **only for
 * `NITRO_PRESET=cloudflare_module`**. Every export throws, and `InvoiceQrCode`
 * already treats an encoder failure as "render no image", so a Worker render
 * degrades to the placeholder tile instead of failing the route.
 */

export default {
	toDataURL: async (): Promise<never> => {
		throw new Error(
			"The QR encoder is browser-only; the Cloudflare Worker build ships a stub.",
		);
	},
};
