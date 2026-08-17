import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center rounded-[var(--hm-r-input)] text-sm font-medium transition-[transform,opacity,background-color,border-color,color] duration-[110ms] ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default:
					"border border-brand bg-brand font-bold text-brand-ink hover:bg-brand-hi",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border border-rule bg-paper-2 text-ink-2 hover:border-brand/50 hover:bg-brand-soft hover:text-ink",
				secondary: "border border-rule bg-paper-3 text-ink-2 hover:bg-paper-3",
				ghost: "text-ink-2 hover:bg-brand-soft hover:text-ink",
				link: "text-brand underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 px-3 text-xs",
				lg: "h-10 px-8",
				icon: "h-9 w-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		const isPrimaryVariant = variant === "default";
		const motionClass = isPrimaryVariant
			? "duration-[200ms] ease-out active:translate-y-px"
			: "duration-[110ms] ease-out active:translate-y-px";
		return (
			<Comp
				className={cn(
					buttonVariants({ variant, size }),
					motionClass,
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
