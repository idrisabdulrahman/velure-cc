import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "#/utils/cn";

interface RouteTransitionProps {
	routeKey: string;
	children: ReactNode;
	className?: string;
}

export function RouteTransition({
	routeKey,
	children,
	className,
}: RouteTransitionProps) {
	const shouldReduceMotion = useReducedMotion();

	if (shouldReduceMotion) {
		return <div className={className}>{children}</div>;
	}

	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={routeKey}
				className={cn("w-full", className)}
				initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
				animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
				exit={{ opacity: 0, y: -4, filter: "blur(1px)" }}
				transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
