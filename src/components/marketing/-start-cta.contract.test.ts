import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WS1 — the signed-out start CTA contract.
 *
 * Public pages must give exactly one obvious next step that opens the sign-up
 * form, and each plan CTA must be a real link rather than an inert button.
 * Source-level assertions (no component harness in this repo) so the deep-link
 * target cannot silently regress.
 */

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const marketingLayout = read("./MarketingLayout.tsx");
const landing = read("../../routes/index.lazy.tsx");
const pricing = read("../../routes/pricing.tsx");
const features = read("../../routes/features.tsx");

const signUpSearch = /search=\{\{ mode: "sign-up" \}\}/g;
const signUpSearchOnce = /search=\{\{ mode: "sign-up" \}\}/;

describe("signed-out start CTA contract", () => {
	it("deep-links sign-up from the nav, the hero and the footer", () => {
		expect(marketingLayout.match(signUpSearch)?.length).toBeGreaterThanOrEqual(
			3,
		);
		expect(marketingLayout).toContain("Get started");
	});

	it("keeps the separate plain sign-in link in the header", () => {
		expect(marketingLayout).toContain(
			'<Link to="/auth" className="hm-label hidden px-3 py-2 sm:block">',
		);
		expect(marketingLayout).not.toContain(
			'search={{ mode: "sign-up" }} className="hm-label',
		);
	});

	it("deep-links sign-up from the homepage hero and lower card", () => {
		expect(landing.match(signUpSearch)?.length).toBeGreaterThanOrEqual(2);
		expect(landing).toContain("Create your workspace");
	});

	it("gives pricing one working pilot CTA plus a sign-in link and no inert plan button", () => {
		expect(pricing).toContain("Join the pilot");
		expect(pricing).toMatch(signUpSearchOnce);
		expect(pricing).toContain(
			'<Link to="/auth" className="hm-btn hm-btn--ghost hm-btn--xl">',
		);
		// The old per-plan button ("Start Starter"/"Start Growth"/…) did nothing.
		expect(pricing).not.toContain("Start {plan.name}");
		expect(pricing).not.toContain("#/components/ui/button");
	});

	it("features no longer claims Slack escalation or automatic sending", () => {
		expect(features).not.toContain("Slack");
		expect(features).not.toMatch(/automatically/i);
		expect(features).toContain("send them yourself");
		expect(features).toContain("Automatic sending is not enabled yet.");
	});
});
