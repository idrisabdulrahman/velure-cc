import { AnimatePresence, motion } from "framer-motion";
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
	return (
		<AnimatePresence mode="popLayout" initial={false}>
			<motion.div
				key={routeKey}
				className={cn("w-full", className)}
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
