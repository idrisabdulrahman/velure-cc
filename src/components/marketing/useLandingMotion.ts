import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP, ScrollSmoother, ScrollTrigger, SplitText);

const EASE = "power3.out";

/**
 * Landing-only motion. Heavier than useMarketingMotion (which stays reveal-only
 * for /features and /pricing) because this route owns the full choreography:
 * smooth scroll, a pinned horizontal Solutions track, SplitText, counters.
 *
 * ScrollSmoother is scoped to this route on purpose — it transforms its content
 * wrapper, which fights the router's app-wide scrollRestoration/viewTransition
 * and native hash scrolling. So the nav lives OUTSIDE #smooth-wrapper (fixed),
 * and hash landings are driven through smoother.scrollTo() below, including the
 * horizontal panels whose anchors are otherwise unreachable by a vertical jump.
 *
 * `ready` gates init: the route renders an auth-pending loader first (no
 * wrapper, ref unattached), so the effect must re-run once the real marketing
 * markup mounts — hence `ready` in the dependency list.
 */
export function useLandingMotion(
	containerRef: RefObject<HTMLElement | null>,
	ready: boolean,
) {
	useGSAP(
		() => {
			if (!ready) return;
			const mm = gsap.matchMedia();

			mm.add("(prefers-reduced-motion: no-preference)", () => {
				// The auth-pending/redirect state renders a different tree with no
				// wrapper — nothing to animate until the marketing markup mounts.
				if (!document.getElementById("smooth-wrapper")) return;

				const smoother = ScrollSmoother.create({
					wrapper: "#smooth-wrapper",
					content: "#smooth-content",
					smooth: 1.1,
					effects: true, // enables data-speed / data-lag parallax
					normalizeScroll: true,
				});

				// ── Hero headline — SplitText, words rise out of a masked line ──
				const heading =
					containerRef.current?.querySelector<HTMLElement>("[data-split]");
				let split: SplitText | undefined;
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

				// ── Scrub reveals — fade + rise, tied to scroll position ──
				const reveals = gsap.utils.toArray<HTMLElement>("[data-fade-scroll]");
				for (const el of reveals) {
					gsap.from(el, {
						opacity: 0,
						y: 32,
						duration: 0.7,
						ease: EASE,
						scrollTrigger: {
							trigger: el,
							start: "top 86%",
							toggleActions: "play none none reverse",
						},
					});
				}

				// ── Pinned horizontal Solutions track ──
				const track =
					containerRef.current?.querySelector<HTMLElement>("[data-h-track]");
				const viewport = track?.querySelector<HTMLElement>("[data-h-viewport]");
				const panels = gsap.utils.toArray<HTMLElement>("[data-panel]");
				let hTween: gsap.core.Tween | undefined;
				if (
					window.innerWidth >= 768 &&
					track &&
					viewport &&
					panels.length > 1
				) {
					const distance = () => viewport.scrollWidth - window.innerWidth;
					hTween = gsap.to(viewport, {
						x: () => -distance(),
						ease: "none",
						scrollTrigger: {
							id: "solutions-track",
							trigger: track,
							pin: true,
							scrub: 1,
							start: "top top",
							end: () => `+=${distance()}`,
							invalidateOnRefresh: true,
						},
					});
					// Content inside each panel reveals as it scrolls into center.
					for (const panel of panels) {
						gsap.from(panel.querySelectorAll("[data-panel-item]"), {
							opacity: 0,
							y: 40,
							duration: 0.6,
							ease: EASE,
							stagger: 0.08,
							scrollTrigger: {
								trigger: panel,
								containerAnimation: hTween,
								start: "left 72%",
								toggleActions: "play none none reverse",
							},
						});
					}
				}

				// ── Number counters — count up when the stat enters ──
				const counters = gsap.utils.toArray<HTMLElement>("[data-count-to]");
				for (const el of counters) {
					const to = Number.parseFloat(el.dataset.countTo ?? "0");
					const decimals = Number.parseInt(el.dataset.countDecimals ?? "0", 10);
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
					const xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3" });
					const yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3" });
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

				// ── Hash landing — router redirects (/#security …) and in-page
				// anchors both route through the smoother so the transformed
				// content actually moves. Horizontal panels map to a point inside
				// the pinned range, otherwise the jump only reaches the track top.
				const scrollToId = (rawId: string, smooth: boolean) => {
					const id = rawId.replace(/^#/, "");
					if (!id) return;
					const target = document.getElementById(id);
					if (!target) return;
					const panelIndex = panels.findIndex((p) => p.id === id);
					const st = ScrollTrigger.getById("solutions-track");
					if (panelIndex > 0 && st) {
						const y =
							st.start +
							(st.end - st.start) * (panelIndex / (panels.length - 1));
						smoother.scrollTo(y, smooth);
						return;
					}
					smoother.scrollTo(target, smooth, "top 80px");
				};

				// Land an incoming hash after layout settles.
				if (window.location.hash) {
					const hash = window.location.hash;
					ScrollTrigger.refresh();
					gsap.delayedCall(0.1, () => scrollToId(hash, false));
				}

				const onAnchorClick = (e: MouseEvent) => {
					const link = (e.target as HTMLElement)?.closest<HTMLAnchorElement>(
						'a[href^="#"]',
					);
					if (!link) return;
					const href = link.getAttribute("href");
					if (!href || href === "#") return;
					e.preventDefault();
					history.pushState(null, "", href);
					scrollToId(href, true);
				};
				const scope = containerRef.current;
				scope?.addEventListener("click", onAnchorClick);

				return () => {
					scope?.removeEventListener("click", onAnchorClick);
					for (const c of magnetCleanups) c();
					split?.revert();
					smoother.kill();
				};
			});

			return () => mm.revert();
		},
		{ scope: containerRef, dependencies: [ready] },
	);
}
