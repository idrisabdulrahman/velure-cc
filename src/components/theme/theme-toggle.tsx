import { Moon, Sun } from "lucide-react";
import { Button } from "#/components/ui/button";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
	const { theme, toggleTheme } = useTheme();
	const isLight = theme === "light";
	const Icon = isLight ? Moon : Sun;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className={className}
			aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
			title={isLight ? "Switch to dark mode" : "Switch to light mode"}
			onClick={toggleTheme}
		>
			<Icon className="h-4 w-4" />
		</Button>
	);
}
