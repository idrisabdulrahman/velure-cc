import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	reporter: "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
		launchOptions: {
			executablePath:
				process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		},
	},
});
