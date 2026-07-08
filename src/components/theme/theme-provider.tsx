import {
	createContext,
	type ReactNode,
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

	const storedTheme = window.localStorage.getItem(themeStorageKey);
	return storedTheme === "light" || storedTheme === "dark"
		? storedTheme
		: "dark";
}

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") return;

	document.documentElement.classList.toggle("light", theme === "light");
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.body.classList.toggle("light", theme === "light");
	document.body.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(readStoredTheme);

	useEffect(() => {
		applyTheme(theme);
		window.localStorage.setItem(themeStorageKey, theme);
	}, [theme]);

	const value = useMemo<ThemeContextValue>(
		() => ({
			theme,
			setTheme: setThemeState,
			toggleTheme: () => {
				setThemeState((currentTheme) =>
					currentTheme === "dark" ? "light" : "dark",
				);
			},
		}),
		[theme],
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
