import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

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
	useGSAP(() => {
		const mm = gsap.matchMedia();

		mm.add("(prefers-reduced-motion: no-preference)", () => {
			ScrollTrigger.batch("[data-fade-scroll]", {
				start: "top 88%",
				once: true,
				onEnter: (batch) => gsap.fromTo(batch, REVEAL_FROM, REVEAL_TO),
			});
		});

		return () => mm.revert();
	});
}
