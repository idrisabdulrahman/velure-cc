import * as React from "react";
import { cn } from "../../utils";

export interface TextareaProps
	extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					"flex min-h-[60px] w-full border border-[#30352f] bg-[#0f1111] px-3 py-2 text-sm text-[#f2efe7] placeholder:text-[#817d72] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out focus-visible:border-[#c8ff62] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(200,255,98,0.24)] disabled:cursor-not-allowed disabled:opacity-50",
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
