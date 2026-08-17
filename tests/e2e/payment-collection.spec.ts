import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath =
	process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser";
function readLocalEnvValue(name: string) {
	for (const file of [".env.local", ".env"]) {
		if (!existsSync(file)) continue;

		const line = readFileSync(file, "utf8")
			.split(/\r?\n/)
			.find((entry) => entry.startsWith(`${name}=`));

		if (line) {
			return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
		}
	}

	return undefined;
}

const paystackSecret =
	process.env.E2E_PAYSTACK_SECRET ??
	process.env.PAYSTACK_SECRET_KEY ??
	readLocalEnvValue("PAYSTACK_SECRET_KEY") ??
	"sk_test_e2e";

test.use({
	baseURL,
	launchOptions: {
		executablePath,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	},
});

test.describe("invoice payment collection", () => {
	test("rejects unsigned Paystack webhooks at the server boundary", async ({
		request,
	}) => {
		const response = await request.post("/api/payments/paystack/webhook", {
			data: {
				event: "charge.success",
				data: {
					status: "success",
					reference: "velure-e2e-ref",
					amount: 100_000,
					currency: "NGN",
				},
			},
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Unauthorized request.",
		});
	});

	test("rejects signed but incomplete Paystack webhooks", async ({
		request,
	}) => {
		// Build payload missing required `amount` field
		const incomplete = JSON.stringify({
			event: "charge.success",
			data: { status: "success", reference: "velure-e2e-ref" },
		});
		const sig = createHmac("sha512", paystackSecret)
			.update(incomplete)
			.digest("hex");

		const response = await request.post("/api/payments/paystack/webhook", {
			headers: {
				"x-paystack-signature": sig,
				"content-type": "application/json",
			},
			data: incomplete,
		});

		expect(response.status()).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Incomplete request payload.",
		});
	});
});
