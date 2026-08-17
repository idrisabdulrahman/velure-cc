import * as React from "react";
import { cn } from "../../utils";

export interface TextareaProps
	extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					"flex min-h-[60px] w-full rounded-[var(--hm-r-input)] border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out focus-visible:border-brand focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Textarea.displayName = "Textarea";

export { Textarea };
