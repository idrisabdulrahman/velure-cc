import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";

// Layout effect on the client so the first measurement lands before paint;
// plain effect on the server so SSR does not warn about `useLayoutEffect`.
const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useResizeObserver(
	elementRef: RefObject<Element | null>,
): ResizeObserverEntry | undefined {
	const [entry, setEntry] = useState<ResizeObserverEntry>();
	const [node, setNode] = useState<Element | null>(null);

	// The observed element often mounts after the first render: callers render a
	// loading state and return early, so `elementRef.current` is null when the
	// mount-time effect runs. Re-read the ref on every commit so the observer
	// attaches as soon as the element exists. Without this the entry stays
	// undefined forever and callers silently fall back to an unmeasured size.
	useIsomorphicLayoutEffect(() => {
		const next = elementRef.current ?? null;
		setNode((current) => (current === next ? current : next));
	});

	const updateEntry = useCallback(
		([nextEntry]: ResizeObserverEntry[]): void => {
			setEntry(nextEntry);
		},
		[],
	);

	useIsomorphicLayoutEffect(() => {
		if (!node) {
			setEntry(undefined);
			return;
		}

		const observer = new ResizeObserver(updateEntry);

		observer.observe(node);

		return () => observer.disconnect();
	}, [node, updateEntry]);

	return entry;
}
