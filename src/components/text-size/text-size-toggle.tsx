import { Type } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { TEXT_SIZE_ORDER, useTextSize } from "./text-size-provider";

/**
 * Cycles global text size (sm → base → lg). The provider applies the
 * matching class to <html>; this button just updates the persisted store.
 */
export function TextSizeToggle({ className }: { className?: string }) {
	const { size, cycleSize } = useTextSize();
	const currentLabel = TEXT_SIZE_ORDER[TEXT_SIZE_ORDER.indexOf(size)];

	return (
		<TooltipProvider delayDuration={180}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className={className}
						onClick={cycleSize}
						aria-label={`Text size: ${currentLabel}`}
						title={`Text size: ${currentLabel}`}
					>
						<Type className="h-4 w-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent className="rounded-md border-rule bg-paper/95 px-3 py-2 text-xs text-ink shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
					Text size · {currentLabel}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
