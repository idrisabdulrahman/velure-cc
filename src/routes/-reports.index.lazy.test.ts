import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WS3 — Reports must not contradict itself.
 *
 * The repository has no component-test harness, so the two report copy fixes
 * are pinned against the route source: the InsightCallout prints the TOP
 * CUSTOMER'S OWN amount (never the workspace summary total), and a paid-up
 * customer is no longer labelled "all open".
 */

const source = readFileSync(
	fileURLToPath(new URL("./reports.index.lazy.tsx", import.meta.url)),
	"utf8",
);

describe("reports index balance copy", () => {
	it("passes the top customer's own amount into the callout", () => {
		expect(source).toContain("topCustomerAmount={topCustomer?.billedAmount}");
	});

	it("no longer hard-codes that every customer is all open", () => {
		expect(source).not.toContain("all open");
		expect(source).toContain("paid up");
		expect(source).toMatch(/customer\.openInvoiceCount.*open/);
	});
});
