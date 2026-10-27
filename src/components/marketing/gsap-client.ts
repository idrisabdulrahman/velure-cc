/**
 * Lazy GSAP loader.
 *
 * GSAP calls `setTimeout` while its module evaluates (ticker wake during
 * plugin creation). Cloudflare workerd forbids timers in global scope, so a
 * static `import gsap` anywhere in an SSR module graph makes the whole route
 * module fail to load on Pages/Workers — live only, since dev runtimes allow
 * it. Both marketing hooks therefore load GSAP client-side on demand; the
 * server never evaluates the package.
 */
type GsapModule = typeof import("gsap");
type ScrollTriggerModule = typeof import("gsap/ScrollTrigger");
type SplitTextModule = typeof import("gsap/SplitText");

let loader:
	| Promise<{
			gsap: GsapModule["default"];
			ScrollTrigger: ScrollTriggerModule["ScrollTrigger"];
			SplitText: SplitTextModule["SplitText"];
	  }>
	| undefined;

export function loadGsapClient() {
	loader ??= Promise.all([
		import("gsap"),
		import("gsap/ScrollTrigger"),
		import("gsap/SplitText"),
	]).then(([gsap, trigger, split]) => {
		const g = gsap.default;
		g.registerPlugin(trigger.ScrollTrigger, split.SplitText);
		return {
			gsap: g,
			ScrollTrigger: trigger.ScrollTrigger,
			SplitText: split.SplitText,
		};
	});
	return loader;
}

export type GsapClient = Awaited<ReturnType<typeof loadGsapClient>>;
