import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const motion = readFileSync(
	new URL("./useLandingMotion.ts", import.meta.url),
	"utf8",
);
const loader = readFileSync(
	new URL("./gsap-client.ts", import.meta.url),
	"utf8",
);
const landing = readFileSync(
	new URL("../../routes/index.lazy.tsx", import.meta.url),
	"utf8",
);

describe("landing motion contract", () => {
	it("animates every scroll-reveal hook the landing markup declares", () => {
		const hooks = landing.match(/data-fade-scroll/g) ?? [];
		expect(hooks.length).toBeGreaterThan(0);
		// Every `data-fade-scroll` in the route needs an animator, otherwise the
		// attribute is dead weight that silently stops animating.
		expect(motion).toContain('"[data-fade-scroll]"');
	});

	it("keeps the smooth-scroll wrapper ids the motion hook attaches to", () => {
		expect(landing).toContain('id="smooth-wrapper"');
		expect(landing).toContain('id="smooth-content"');
		expect(loader).toContain("gsap/ScrollSmoother");
		expect(motion).toContain("ScrollSmoother.create");
	});

	it("attaches the anchor listener before GSAP resolves", () => {
		const listener = motion.indexOf('scope.addEventListener("click", onClick)');
		const gsapLoad = motion.indexOf("loadGsapClient().then");
		expect(listener).toBeGreaterThan(-1);
		expect(gsapLoad).toBeGreaterThan(-1);
		// The regression this guards: registering the handler inside the GSAP
		// promise meant a click before load jumped natively against transformed
		// content and landed on a blank area.
		expect(listener).toBeLessThan(gsapLoad);
	});

	it("only prevents the native jump once a smoother is driving the page", () => {
		const handler = motion.slice(
			motion.indexOf("const onClick ="),
			motion.indexOf("scope.addEventListener"),
		);
		expect(handler).toContain("if (!target || !smoother) return;");
		expect(handler.indexOf("event.preventDefault()")).toBeGreaterThan(
			handler.indexOf("if (!target || !smoother) return;"),
		);
	});

	it("plays reveals once so a hash jump can never leave a section hidden", () => {
		const reveal = motion.slice(
			motion.indexOf('"[data-fade-scroll]"'),
			motion.indexOf("// ── Number counters"),
		);
		expect(reveal).toContain("once: true");
		expect(reveal).not.toContain("reverse");
	});

	it("lands hashes through the smoother and falls back to native scrolling", () => {
		expect(motion).toContain("smoother.scrollTo(");
		expect(landing).toContain("scrollToHash(hash)");
		expect(landing).toContain('scrollIntoView({ behavior: "instant" })');
	});

	it("still honors reduced-motion preferences", () => {
		expect(motion).toContain("(prefers-reduced-motion: no-preference)");
	});
});
