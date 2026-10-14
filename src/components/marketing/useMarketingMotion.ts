import { useEffect, useLayoutEffect } from "react";
import { type GsapClient, loadGsapClient } from "./gsap-client";

// Layout-effect timing on the client (no animation flash), inert on the
// server where effect callbacks never run.
const useIsoLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

const REVEAL_FROM = { opacity: 0, y: 8 } as const;
const REVEAL_TO = {
	opacity: 1,
	y: 0,
	duration: 0.5,
	ease: "power3.out",
	stagger: 0.07,
	overwrite: true,
} as const;

export function useMarketingMotion(): void {
	useIsoLayoutEffect(() => {
		let cancelled = false;
		let mm: ReturnType<GsapClient["gsap"]["matchMedia"]> | undefined;

		void loadGsapClient().then(({ gsap, ScrollTrigger }) => {
			if (cancelled) return;
			mm = gsap.matchMedia();

			mm.add("(prefers-reduced-motion: no-preference)", () => {
				ScrollTrigger.batch("[data-fade-scroll]", {
					start: "top 88%",
					once: true,
					onEnter: (batch) => gsap.fromTo(batch, REVEAL_FROM, REVEAL_TO),
				});
			});
		});

		return () => {
			cancelled = true;
			mm?.revert();
		};
	}, []);
}
