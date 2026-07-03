"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import * as React from "react";
import { cn } from "../../utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn(
			"fixed inset-0 z-50 bg-[#050606]/82 backdrop-blur-[3px] transition-[opacity,background-color] data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:duration-[220ms] data-[state=closed]:duration-[180ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:ease-out",
			className,
		)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
		hideClose?: boolean;
	}
>(({ className, children, hideClose, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"vl-ledger-bg fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-10vw)] w-[90vw] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-[#30352f] bg-[#0f1111] text-[#f2efe7] shadow-[0_24px_80px_rgba(0,0,0,0.42)] transition-[transform,opacity,background-color,border-color,color] data-[state=open]:translate-x-[-50%] data-[state=open]:translate-y-[-50%] data-[state=open]:opacity-100 data-[state=closed]:translate-x-[-50%] data-[state=closed]:translate-y-[calc(-50%+8px)] data-[state=closed]:opacity-0 data-[state=open]:duration-[220ms] data-[state=closed]:duration-[180ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:ease-out dark:p-px",
				className,
			)}
			{...props}
		>
			{children}

			{!hideClose && (
				<DialogPrimitive.Close className="absolute right-6 top-6 inline-flex h-8 w-8 items-center justify-center border border-transparent bg-transparent text-current opacity-70 transition-[transform,opacity,background-color,border-color,color] duration-[110ms] ease-out hover:border-[#30352f] hover:bg-[#1a2117] hover:opacity-100 active:scale-[0.94] focus:outline-none focus-visible:shadow-[0_0_0_2px_rgba(200,255,98,0.24)] disabled:pointer-events-none">
					<Cross2Icon className="h-4 w-4" />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			)}
		</DialogPrimitive.Content>
	</DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogContentFrameless = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"vl-ledger-bg fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-xl -translate-x-1/2 -translate-y-1/2 border border-[#30352f] bg-[#0f1111] text-[#f2efe7] transition-[transform,opacity,background-color,border-color,color] data-[state=open]:translate-x-[-50%] data-[state=open]:translate-y-[-50%] data-[state=open]:opacity-100 data-[state=closed]:translate-x-[-50%] data-[state=closed]:translate-y-[calc(-50%+8px)] data-[state=closed]:opacity-0 data-[state=open]:duration-[220ms] data-[state=closed]:duration-[180ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:ease-out dark:border-none dark:p-px",
				className,
			)}
			{...props}
		>
			{children}
		</DialogPrimitive.Content>
	</DialogPortal>
));

const DialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-col space-y-1.5 text-left", className)}
		{...props}
	/>
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
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
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn(
			"text-lg font-semibold leading-none tracking-tight mb-4",
			className,
		)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-sm text-[#817d72]", className)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Dialog,
	DialogPortal,
	DialogOverlay,
	DialogTrigger,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
	DialogContentFrameless,
};
