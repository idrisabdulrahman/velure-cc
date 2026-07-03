import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center text-sm font-medium transition-[transform,opacity,background-color,border-color,color] duration-[110ms] ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(200,255,98,0.38)] disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default:
					"border border-[#c8ff62] bg-[#c8ff62] font-bold text-[#0f1111] hover:bg-[#d5ff7a]",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border border-[#30352f] bg-[#171a18] text-[#d8d1c4] hover:border-[#c8ff62]/50 hover:bg-[#1a2117] hover:text-[#f2efe7]",
				secondary:
					"border border-[#30352f] bg-[#121514] text-[#d8d1c4] hover:bg-[#20241f]",
				ghost: "text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]",
				link: "text-[#c8ff62] underline-offset-4 hover:underline",
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
			? "duration-[150ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.96]"
			: "duration-[110ms] ease-out active:scale-[0.94]";
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
