import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { type GsapClient, loadGsapClient } from "./gsap-client";

// Layout-effect timing on the client (no animation flash), inert on the
// server where effect callbacks never run.
const useIsoLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

const EASE = "power3.out";
/** Keep anchor targets clear of the sticky marketing nav. */
const NAV_OFFSET = "top 88px";

type Smoother = InstanceType<GsapClient["ScrollSmoother"]>;

/**
 * Landing-only motion: smooth scroll, masked hero rise, scroll reveals,
 * counters, and magnetic CTAs.
 *
 * GSAP is loaded lazily (see gsap-client.ts) — its module scope calls
 * setTimeout, which the Cloudflare Workers runtime rejects, so a static import
 * would break SSR of this route on the deployed edge.
 *
 * Anchor handling is deliberately split in two:
 *
 *   1. The click listener is attached synchronously, before GSAP resolves, so
 *      "See the system" works on the first click. It only calls
 *      `preventDefault()` once a smoother is actually driving the page; until
 *      then the browser's native hash jump is correct, because nothing has
 *      transformed the layout yet.
 *   2. Once the smoother exists, any incoming or clicked hash is re-landed
 *      through `smoother.scrollTo()`, so the jump matches the transformed
 *      scroll path instead of the raw document offset.
 *
 * That combination is what the earlier regression missed: the old code
 * registered the listener *inside* the GSAP promise and always called
 * `preventDefault()`, so an early click jumped natively against transformed
 * content and landed on a blank area.
 *
 * `ready` gates init: the route renders an auth-pending loader first (no
 * wrapper, ref unattached), so the effect must re-run once the real marketing
 * markup mounts — hence `ready` in the dependency list.
 *
 * @returns `scrollToHash` — scrolls to an in-page id through the smoother and
 * returns `false` when the smoother is not ready, so the caller can fall back
 * to native `scrollIntoView`.
 */
export function useLandingMotion(
	containerRef: RefObject<HTMLElement | null>,
	ready: boolean,
) {
	const smootherRef = useRef<Smoother | null>(null);

	// 1 ── Anchor interception, attached before GSAP loads.
	useIsoLayoutEffect(() => {
		if (!ready) return;
		const scope = containerRef.current;
		if (!scope) return;

		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}
			const link = (event.target as HTMLElement | null)?.closest?.(
				'a[href^="#"]',
			);
			const href = link?.getAttribute("href");
			if (!href || href === "#") return;

			const target = document.getElementById(href.slice(1));
			const smoother = smootherRef.current;
			// No smoother yet: let the browser do a native jump. The document
			// is still untransformed, so the native position is correct.
			if (!target || !smoother) return;

			event.preventDefault();
			window.history.pushState(null, "", href);
			smoother.scrollTo(target, true, NAV_OFFSET);
		};

		scope.addEventListener("click", onClick);
		return () => scope.removeEventListener("click", onClick);
	}, [ready, containerRef]);

	// 2 ── GSAP setup: smoother, hero, reveals, counters, magnets.
	useIsoLayoutEffect(() => {
		if (!ready) return;
		let cancelled = false;
		let ctx: { revert: () => void } | undefined;

		void loadGsapClient().then(
			({ gsap, ScrollSmoother, ScrollTrigger, SplitText }) => {
				if (cancelled) return;

				ctx = gsap.context(() => {
					const mm = gsap.matchMedia();

					mm.add("(prefers-reduced-motion: no-preference)", () => {
						// The auth-pending/redirect state renders a different tree
						// with no wrapper — nothing to animate until the marketing
						// markup mounts.
						if (!document.getElementById("smooth-wrapper")) return;

						// The smoother owns the scroll position while it is alive; the
						// browser's own restoration fights it on refresh/back.
						const previousRestoration = history.scrollRestoration;
						history.scrollRestoration = "manual";

						const smoother = ScrollSmoother.create({
							wrapper: "#smooth-wrapper",
							content: "#smooth-content",
							smooth: 1.1,
							// Native scrolling on touch devices: smoothing there costs
							// battery and fights the browser's own momentum/zoom.
							smoothTouch: false,
							// No data-speed/data-lag attributes exist in this markup,
							// so the parallax scan would be pure overhead.
							effects: false,
							// normalizeScroll would take over touch and fixed/sticky
							// positioning; the sticky nav must stay native.
							normalizeScroll: false,
						});
						smootherRef.current = smoother;

						// ── Hero headline — words rise out of a masked line ──
						// No opacity fade here: the headline is the LCP element, and
						// starting it at opacity 0 makes the browser record LCP only
						// after the animation finishes.
						const heading =
							containerRef.current?.querySelector<HTMLElement>("[data-split]");
						let split: InstanceType<GsapClient["SplitText"]> | undefined;
						if (heading) {
							split = SplitText.create(heading, {
								type: "words,lines",
								mask: "lines",
								linesClass: "hm-split-line",
							});
							gsap.from(split.words, {
								yPercent: 100,
								duration: 0.8,
								ease: EASE,
								stagger: 0.045,
							});
						}

						// ── Scroll reveals — fade + rise, played once ──
						// `once: true` pins toggleActions to "play none none none":
						// a reveal can never reverse itself back to invisible, which
						// is what left sections blank after a hash jump.
						for (const el of gsap.utils.toArray<HTMLElement>(
							"[data-fade-scroll]",
							containerRef.current,
						)) {
							gsap.from(el, {
								opacity: 0,
								y: 32,
								duration: 0.7,
								ease: EASE,
								scrollTrigger: {
									trigger: el,
									start: "top 92%",
									once: true,
									invalidateOnRefresh: true,
								},
							});
						}

						// ── Number counters — count up when the stat enters ──
						for (const el of gsap.utils.toArray<HTMLElement>(
							"[data-count-to]",
						)) {
							const to = Number.parseFloat(el.dataset.countTo ?? "0");
							const decimals = Number.parseInt(
								el.dataset.countDecimals ?? "0",
								10,
							);
							const prefix = el.dataset.countPrefix ?? "";
							const suffix = el.dataset.countSuffix ?? "";
							const obj = { v: 0 };
							gsap.to(obj, {
								v: to,
								duration: 1.2,
								ease: "power2.out",
								scrollTrigger: { trigger: el, start: "top 88%", once: true },
								onUpdate: () => {
									el.textContent = `${prefix}${obj.v.toFixed(decimals)}${suffix}`;
								},
							});
						}

						// ── Magnetic CTAs — pull toward the cursor, spring back ──
						const magnetCleanups: Array<() => void> = [];
						for (const el of gsap.utils.toArray<HTMLElement>(
							"[data-magnetic]",
						)) {
							const xTo = gsap.quickTo(el, "x", {
								duration: 0.4,
								ease: "power3",
							});
							const yTo = gsap.quickTo(el, "y", {
								duration: 0.4,
								ease: "power3",
							});
							const move = (e: PointerEvent) => {
								const r = el.getBoundingClientRect();
								xTo((e.clientX - (r.left + r.width / 2)) * 0.35);
								yTo((e.clientY - (r.top + r.height / 2)) * 0.35);
							};
							const reset = () => {
								xTo(0);
								yTo(0);
							};
							el.addEventListener("pointermove", move);
							el.addEventListener("pointerleave", reset);
							magnetCleanups.push(() => {
								el.removeEventListener("pointermove", move);
								el.removeEventListener("pointerleave", reset);
							});
						}

						// ── Land any incoming hash once the transform is live ──
						// A hash present at first paint was already jumped to natively
						// (correct before the smoother existed); re-land it now so the
						// position matches the transformed scroll path. Refresh first,
						// which also plays reveals whose trigger is already in view.
						if (window.location.hash) {
							gsap.delayedCall(0.2, () => {
								const target = document.getElementById(
									window.location.hash.replace(/^#/, ""),
								);
								if (!target) return;
								ScrollTrigger.refresh();
								smoother.scrollTo(target, false, NAV_OFFSET);
							});
						}

						// Late layout work (fonts, images) shifts every trigger.
						const onLoad = () => ScrollTrigger.refresh();
						window.addEventListener("load", onLoad);
						document.fonts?.ready.then(onLoad).catch(() => {});

						return () => {
							window.removeEventListener("load", onLoad);
							for (const cleanup of magnetCleanups) cleanup();
							split?.revert();
							smootherRef.current = null;
							smoother.kill();
							history.scrollRestoration = previousRestoration;
						};
					});

					return () => mm.revert();
				}, containerRef);
			},
		);

		return () => {
			cancelled = true;
			smootherRef.current = null;
			ctx?.revert();
		};
	}, [ready, containerRef]);

	/**
	 * Scrolls to an in-page id through the smoother. Returns `false` when the
	 * smoother is not driving the page yet, so callers can fall back to native
	 * `scrollIntoView`.
	 */
	return useCallback((hash: string) => {
		const smoother = smootherRef.current;
		const id = hash.replace(/^#/, "");
		const target = id ? document.getElementById(id) : null;
		if (!smoother || !target) return false;
		smoother.scrollTo(target, false, NAV_OFFSET);
		return true;
	}, []);
}
