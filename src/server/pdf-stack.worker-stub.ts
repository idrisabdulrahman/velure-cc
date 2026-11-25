/**
 * Cloudflare Worker build stub for the Node PDF stack.
 *
 * `@react-pdf/renderer` is not portable to Workers: it needs `fontkit` +
 * `brotli` to load fonts, yoga-layout for layout, and it reads
 * `import.meta.url`-relative data files at module scope (that last property took
 * every route down on the first deploy - see `docs/cloudflare-setup.md` §13).
 * The recorded decision is `reject`, with `renderFallbackPdf` in
 * `src/server/pdf.ts` as the pure-JS writer.
 *
 * `vite.config.ts` aliases both `@react-pdf/renderer` and the PDF template
 * directory to this module **only for `NITRO_PRESET=cloudflare_module`**, which
 * removes roughly 2.6 MiB of server chunks nothing on the Worker can execute.
 * The Node/VPS build and the tests keep the real renderer.
 *
 * Every export throws: `renderInvoicePdf` catches the failure and returns the
 * fallback PDF, so a Worker PDF download degrades instead of erroring.
 */

const MESSAGE =
	"The react-pdf renderer is not part of the Cloudflare Workers build; " +
	"renderInvoicePdf falls back to the built-in PDF writer.";

export async function renderToBuffer(): Promise<never> {
	throw new Error(MESSAGE);
}

export async function PdfTemplate(): Promise<never> {
	throw new Error(MESSAGE);
}
