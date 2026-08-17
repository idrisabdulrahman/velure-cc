import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type Theme = "dark" | "light";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
};

const themeStorageKey = "velure.theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
	if (typeof window === "undefined") return "dark";

	try {
		const storedTheme = window.localStorage.getItem(themeStorageKey);
		return storedTheme === "light" || storedTheme === "dark"
			? storedTheme
			: "dark";
	} catch {
		// Storage unavailable (private mode, blocked cookies) — keep the
		// default. The inline head script already guards with try/catch too.
		return "dark";
	}
}

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") return;

	document.documentElement.classList.toggle("light", theme === "light");
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.body.classList.toggle("light", theme === "light");
	document.body.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

function prefersReducedMotion() {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(readStoredTheme);

	useEffect(() => {
		applyTheme(theme);
		try {
			window.localStorage.setItem(themeStorageKey, theme);
		} catch {
			// Storage unavailable — theme still applies for this session.
		}
	}, [theme]);

	const changeTheme = useCallback(
		(newTheme: Theme) => {
			if (theme === newTheme) return;

			if (
				typeof document !== "undefined" &&
				document.startViewTransition &&
				!prefersReducedMotion()
			) {
				document.startViewTransition(() => {
					applyTheme(newTheme);
				});
			} else {
				applyTheme(newTheme);
			}
			setThemeState(newTheme);
		},
		[theme],
	);

	const value = useMemo<ThemeContextValue>(
		() => ({
			theme,
			setTheme: changeTheme,
			toggleTheme: () => {
				changeTheme(theme === "dark" ? "light" : "dark");
			},
		}),
		[theme, changeTheme],
	);

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);

	if (!context) {
		throw new Error("useTheme must be used within ThemeProvider");
	}

	return context;
}
