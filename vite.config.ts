import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const isTest = process.env.VITEST === "true";

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

						if (
							id.includes("@react-pdf/") ||
							id.includes("/qrcode") ||
							id.includes("/fontkit") ||
							id.includes("/pdfkit")
						) {
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
			"**/tests/e2e/**",
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
		!isTest ? nitro({ rollupConfig: { external: [/^@sentry\//] } }) : null,
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
