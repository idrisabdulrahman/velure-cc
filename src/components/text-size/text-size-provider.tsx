import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export type TextSize = "sm" | "base" | "lg";

export const TEXT_SIZE_ORDER: TextSize[] = ["sm", "base", "lg"];

/** Tailwind classes applied to <html> to scale text globally. */
export const TEXT_SIZE_CLASS: Record<TextSize, string> = {
	sm: "text-sm",
	base: "text-base",
	lg: "text-lg",
};

type TextSizeContextValue = {
	size: TextSize;
	setSize: (size: TextSize) => void;
	cycleSize: () => void;
};

const textSizeStorageKey = "velure.textSize";
const TextSizeContext = createContext<TextSizeContextValue | null>(null);

function readStoredSize(): TextSize {
	if (typeof window === "undefined") return "sm";

	const stored = window.localStorage.getItem(textSizeStorageKey);
	return TEXT_SIZE_ORDER.includes(stored as TextSize)
		? (stored as TextSize)
		: "base";
}

function applyTextSize(size: TextSize) {
	if (typeof document === "undefined") return;

	const el = document.documentElement;
	for (const cls of Object.values(TEXT_SIZE_CLASS)) {
		el.classList.remove(cls);
	}
	el.classList.add(TEXT_SIZE_CLASS[size]);
}

/**
 * Global text size, persisted to localStorage. The provider applies the
 * matching class to <html> in an effect so it is hydration-safe.
 */
export function TextSizeProvider({ children }: { children: ReactNode }) {
	const [size, setSizeState] = useState<TextSize>(readStoredSize);

	useEffect(() => {
		applyTextSize(size);
		window.localStorage.setItem(textSizeStorageKey, size);
	}, [size]);

	const setSize = useCallback((next: TextSize) => {
		setSizeState(next);
	}, []);

	const cycleSize = useCallback(() => {
		setSizeState((current) => {
			const next =
				TEXT_SIZE_ORDER[
					(TEXT_SIZE_ORDER.indexOf(current) + 1) % TEXT_SIZE_ORDER.length
				];
			return next;
		});
	}, []);

	const value = useMemo<TextSizeContextValue>(
		() => ({ size, setSize, cycleSize }),
		[size, setSize, cycleSize],
	);

	return (
		<TextSizeContext.Provider value={value}>
			{children}
		</TextSizeContext.Provider>
	);
}

export function useTextSize() {
	const context = useContext(TextSizeContext);

	if (!context) {
		throw new Error("useTextSize must be used within TextSizeProvider");
	}

	return context;
}
