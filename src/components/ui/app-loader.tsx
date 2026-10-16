import { useReducedMotion } from "framer-motion";
import { Spinner } from "#/components/ui/spinner";
import { cn } from "#/lib/utils";

type AppLoaderProps = {
	/**
	 * Sentence-case, no ellipsis, no filler — matches PanelLoader's voice.
	 * Defaults to `null` (bare spinner): most waits are session/bridge/query
	 * resolution, not provisioning. Only pass "Setting up your workspace"
	 * while actually creating a first-time workspace.
	 */
	label?: string | null;
	className?: string;
};

/**
 * Full-screen honest wait state: an indeterminate spinner, never a simulated
 * progress bar. There is no measurable progress in session/bridge/workspace
 * resolution, so nothing advances, fills, or completes on a timer. Under
 * reduced motion it renders a static track and spins nothing.
 */
export function AppLoader({ label = null, className }: AppLoaderProps) {
	const reduceMotion = useReducedMotion();

	return (
		<div
			role="status"
			aria-label={label ?? "Loading"}
			className={cn(
				"flex flex-col items-center justify-center gap-5 p-8",
				className,
			)}
		>
			{reduceMotion ? (
				<div className="h-1.5 w-40 rounded-full bg-rule" />
			) : (
				<Spinner size={28} className="text-brand !stroke-brand" />
			)}

			{label ? (
				<p
					aria-live="polite"
					className="text-center text-sm font-medium tracking-tight text-ink-2"
				>
					{label}
				</p>
			) : null}
		</div>
	);
}
