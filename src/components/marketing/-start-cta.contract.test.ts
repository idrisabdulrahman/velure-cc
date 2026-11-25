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
const pricingSection = read("./PricingSection.tsx");
const pricing = read("../../routes/pricing.tsx");
const features = read("../../routes/features.tsx");

const signUpSearch = /search=\{\{ mode: "sign-up" \}\}/g;
const signUpSearchOnce = /search=\{\{ mode: "sign-up" \}\}/;

describe("signed-out start CTA contract", () => {
	it("deep-links sign-up from the nav, the hero and the footer", () => {
		expect(marketingLayout.match(signUpSearch)?.length).toBeGreaterThanOrEqual(
			3,
		);
		expect(marketingLayout).toContain("Start free trial");
		// The trial is free and cardless — every hero carries the no-card line.
		expect(marketingLayout).toContain(
			"Try 3 days free — no credit card required.",
		);
	});

	it("keeps the separate plain sign-in link in the header", () => {
		expect(marketingLayout).toContain(
			'<Link to="/auth" className="hm-label hidden px-3 py-2 sm:block">',
		);
		expect(marketingLayout).not.toContain(
			'search={{ mode: "sign-up" }} className="hm-label',
		);
	});

	it("deep-links sign-up from the homepage hero and pricing cards", () => {
		// Hero on the landing; the per-tier trial CTA lives once in the shared
		// PricingSection source and renders per card.
		expect(landing.match(signUpSearch)?.length).toBeGreaterThanOrEqual(1);
		expect(pricingSection.match(signUpSearch)?.length).toBe(1);
		expect(landing).toContain("Start free trial");
		expect(pricingSection).toContain("Try 3 days free");
	});

	it("gives pricing working trial CTAs in the shared tier cards, not inert price blocks", () => {
		// The /pricing page and the homepage section share PricingCards/PricingToggle.
		expect(pricing).toContain("PricingCards");
		expect(pricing).toContain("PricingToggle");
		// The trial banner stays on the pricing page.
		expect(pricing).toContain(
			"Every plan starts with a 3-day free trial. No credit card required.",
		);
		// Every tier card carries one real sign-up CTA (source renders per card).
		expect(pricingSection).toContain("Try 3 days free");
		expect(pricingSection).toMatch(signUpSearchOnce);
		// The old per-plan button ("Start Starter"/"Start Growth"/...) did nothing.
		expect(pricing).not.toContain("Start {plan.name}");
		expect(pricing).not.toContain("#/components/ui/button");
	});

	it("features claims automatic sending (live since 2026-11-22) and no Slack escalation", () => {
		expect(features).not.toContain("Slack");
		expect(features).toContain("send themselves");
		expect(features).toContain("automatically");
		expect(features).not.toContain("not enabled yet");
	});
});
