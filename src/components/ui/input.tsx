import * as React from "react";
import { cn } from "../../utils";

export interface InputProps
	extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type, onFocus, ...props }, ref) => {
		const numberInputClassName =
			type === "number"
				? "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
				: "";

		return (
			<input
				type={type}
				className={cn(
					"flex h-9 w-full rounded-[var(--hm-r-input)] border border-rule bg-paper px-3 py-1 text-sm text-ink transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-3 focus-visible:border-brand focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50 autofill:[-webkit-text-fill-color:currentColor] [&:-webkit-autofill]:!bg-transparent [&:-webkit-autofill]:!bg-none [&:-webkit-autofill]:!shadow-[inset_0_0_0px_1000px_transparent] [&:-webkit-autofill]:[-webkit-text-fill-color:currentColor] [&:-webkit-autofill]:[transition:background-color_9999s_ease-out,color_9999s_ease-out]",
					numberInputClassName,
					className,
				)}
				onFocus={(e) => {
					e.target.select();
					onFocus?.(e);
				}}
				ref={ref}
				{...props}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input };
