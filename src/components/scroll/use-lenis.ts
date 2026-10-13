import Lenis from "lenis";
import { type RefObject, useEffect, useRef } from "react";

type UseLenisOptions = {
	wrapperRef: RefObject<HTMLElement | null>;
	contentRef: RefObject<HTMLElement | null>;
	/** True once the scroll container is mounted (post-auth gates). */
	ready?: boolean;
	/** When true (e.g. prefers-reduced-motion), Lenis never inits. */
	disabled?: boolean;
	/** Lerp intensity 0..1. Defaults to 0.1 for a calm glide. */
	lerp?: number;
};

/**
 * Drives a custom scroll container (the app shell's `main`) with Lenis.
 * Returns a ref to the live instance (null when disabled or unmounted).
 * Route changes should scroll via `lenis.scrollTo(0, { immediate: true })`
 * with a native `scrollTo` fallback.
 */
export function useLenis({
	wrapperRef,
	contentRef,
	ready = true,
	disabled = false,
	lerp = 0.1,
}: UseLenisOptions) {
	const lenisRef = useRef<Lenis | null>(null);

	useEffect(() => {
		const wrapper = wrapperRef.current;
		const content = contentRef.current;
		if (!ready || disabled || !wrapper || !content) return;

		const lenis = new Lenis({
			wrapper,
			content,
			autoRaf: true,
			lerp,
			smoothWheel: true,
		});
		lenisRef.current = lenis;

		return () => {
			lenis.destroy();
			lenisRef.current = null;
		};
	}, [contentRef, disabled, lerp, ready, wrapperRef]);

	return lenisRef;
}
