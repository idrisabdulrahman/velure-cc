import { motion } from "framer-motion";
import { Spinner } from "./spinner";

export function PanelLoader({ label }: { label: string }) {
	return (
		<motion.div
			className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-sm text-ink-3"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.18 }}
		>
			<Spinner size={24} className="text-brand !stroke-brand" />
			<span>{label}</span>
		</motion.div>
	);
}
