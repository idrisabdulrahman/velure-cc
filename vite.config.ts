import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import type { Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const isTest = process.env.VITEST === "true";

/**
 * The Nitro preset is selected by `NITRO_PRESET` (see `package.json` scripts),
 * the same way the Cloudflare Pages build already works.
 *
 * `cloudflare_module` inherits Nitro's default `.output` directory, which is
 * also where the Node/VPS build lands. They would overwrite each other, and
 * deploying a Node entry to Workers fails confusingly. Give the Worker its own
 * directory so both artifacts can coexist and neither can silently replace the
 * other. The Pages preset already owns `dist`; Node keeps `.output`.
 */
const isCloudflareWorker = process.env.NITRO_PRESET === "cloudflare_module";
const workerOutputDir = "dist-worker";

/**
 * The success-panel QR (`InvoiceQrCode`) is generated in the browser. The
 * Node entry of `qrcode` evaluates `fs` and `pngjs` at module scope, so it must
 * not be pulled into the Worker's server build.
 *
 * This has to be a plugin rather than a `resolve.alias` entry: an alias would
 * also rewrite the **client** build of the same Worker build, shipping the
 * throwing stub to the browser and silently breaking every QR.
 */
function qrCodeServerStub(): Plugin {
	return {
		name: "velure-qrcode-server-stub",
		enforce: "pre",
		resolveId(source) {
			if (this.environment?.name === "client") return null;
			if (source === "qrcode") {
				return fileURLToPath(
					new URL("./src/server/qr-code.worker-stub.ts", import.meta.url),
				);
			}
			return null;
		},
	};
}

const config = defineConfig({
	build: {
		chunkSizeWarningLimit: 1000, // raises the warning threshold to 1MB
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules")) {
						if (
							id.includes("/react-dom/") ||
							id.includes("/react/") ||
							id.includes("/scheduler/")
						) {
							return "react-vendor";
						}

						if (id.includes("/pdf-lib/") || id.includes("/qrcode")) {
							return "pdf-vendor";
						}

						if (id.includes("framer-motion")) {
							return "motion-vendor";
						}
					}
				},
			},
		},
	},
	test: {
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/tests/**",
			"**/e2e/**",
			"**/.worktrees/**",
		],
	},
	ssr: {
		// @visx 4.0.1-alpha.0 ships an ESM build with extensionless internal
		// imports (`export … from './scales/band'`), which Node's ESM resolver
		// rejects during SSR. Bundling them through Vite resolves the paths.
		noExternal: [/^@visx\//],
	},
	plugins: [
		!isTest
			? nitro({
					...(isCloudflareWorker ? { output: { dir: workerOutputDir } } : {}),
					rollupConfig: { external: [/^@sentry\//] },
				})
			: null,
		isCloudflareWorker ? qrCodeServerStub() : null,
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		!isTest ? tanstackStart() : null,
		viteReact({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
	].filter(Boolean),
});

export default config;
