import { type RefObject, useEffect, useLayoutEffect } from "react";
import { type GsapClient, loadGsapClient } from "./gsap-client";

// Layout-effect timing on the client (no animation flash), inert on the
// server where effect callbacks never run.
const useIsoLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

const EASE = "power3.out";

/**
 * Landing-only motion: SplitText, counters, and magnetic CTAs.
 * Section links use native hash scrolling so a click works before GSAP loads.
 *
 * GSAP is loaded lazily (see gsap-client.ts) — its module scope calls
 * setTimeout, which Cloudflare Workers runtime rejects, so a static import
 * would break SSR of this route on the deployed edge.
 *
 * `ready` gates init: the route renders an auth-pending loader first (no
 * wrapper, ref unattached), so the effect must re-run once the real marketing
 * markup mounts — hence `ready` in the dependency list.
 */
export function useLandingMotion(
	containerRef: RefObject<HTMLElement | null>,
	ready: boolean,
) {
	useIsoLayoutEffect(() => {
		if (!ready) return;
		let cancelled = false;
		let ctx: { revert: () => void } | undefined;

		void loadGsapClient().then(({ gsap, SplitText }) => {
			if (cancelled) return;
			ctx = gsap.context(() => {
				const mm = gsap.matchMedia();

				mm.add("(prefers-reduced-motion: no-preference)", () => {
					// The auth-pending/redirect state renders a different tree
					// with no wrapper — nothing to animate until the marketing
					// markup mounts.
					if (!document.getElementById("smooth-wrapper")) return;

					// ── Hero headline — SplitText, words rise out of a masked line ──
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
							yPercent: 110,
							opacity: 0,
							duration: 0.8,
							ease: EASE,
							stagger: 0.045,
						});
					}

					// ── Number counters — count up when the stat enters ──
					const counters = gsap.utils.toArray<HTMLElement>("[data-count-to]");
					for (const el of counters) {
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

					// ── Magnetic CTAs — pull toward the cursor, spring back on leave ──
					const magnets = gsap.utils.toArray<HTMLElement>("[data-magnetic]");
					const magnetCleanups: Array<() => void> = [];
					for (const el of magnets) {
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

					return () => {
						for (const c of magnetCleanups) c();
						split?.revert();
					};
				});

				return () => mm.revert();
			}, containerRef);
		});

		return () => {
			cancelled = true;
			ctx?.revert();
		};
	}, [ready, containerRef]);
}
