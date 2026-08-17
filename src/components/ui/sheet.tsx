"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Overlay
		className={cn(
			"fixed inset-0 z-50 bg-[var(--hm-scrim)] transition-[opacity,background-color] data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:duration-[160ms] data-[state=closed]:duration-[120ms]",
			className,
		)}
		{...props}
		ref={ref}
	/>
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
	"fixed z-50 transition-transform data-[state=open]:duration-[220ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:duration-[180ms] data-[state=closed]:ease-out",
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 data-[state=open]:translate-y-0 data-[state=closed]:-translate-y-full",
				bottom:
					"inset-x-0 bottom-0 data-[state=open]:translate-y-0 data-[state=closed]:translate-y-full",
				left: "inset-y-0 left-0 h-full w-3/4 data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full sm:max-w-sm",
				right:
					"inset-y-0 right-0 h-full w-3/4 data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full sm:max-w-[520px]",
			},
		},
		defaultVariants: {
			side: "right",
		},
	},
);

interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
		VariantProps<typeof sheetVariants> {
	stack?: boolean;
	contentClassName?: string;
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(
	(
		{
			side = "right",
			stack: _stack = false,
			className,
			contentClassName,
			children,
			title,
			...props
		},
		ref,
	) => (
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Content
				onOpenAutoFocus={(e) => e.preventDefault()}
				ref={ref}
				className={cn("md:p-4", sheetVariants({ side }), contentClassName)}
				aria-describedby={props["aria-describedby"] || undefined}
				{...props}
			>
				<div
					className={cn(
						"vl-ledger-bg relative h-full w-full overflow-hidden border border-rule bg-paper p-6 text-ink shadow-[0_24px_80px_rgba(0,0,0,0.38)]",
						className,
					)}
				>
					<SheetTitle className="sr-only">{title}</SheetTitle>
					{children}
				</div>
			</SheetPrimitive.Content>
		</SheetPortal>
	),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col space-y-2 text-center sm:text-left",
			className,
		)}
		{...props}
	/>
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
			className,
		)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
		ref={ref}
		className={cn("text-lg font-semibold text-ink", className)}
		{...props}
	/>
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-sm text-ink-3", className)}
		{...props}
	/>
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
	Sheet,
	SheetPortal,
	SheetOverlay,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
