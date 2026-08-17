interface BubbleMenuButtonProps {
	action: () => void;
	isActive: boolean;
	children: React.ReactNode;
	className?: string;
}

export function BubbleMenuButton({
	action,
	isActive,
	children,
	className,
}: BubbleMenuButtonProps) {
	return (
		<button
			type="button"
			onClick={action}
			className={`px-2.5 py-1.5 text-[11px] transition-colors ${className} ${
				isActive
					? "bg-paper-3 text-ink"
					: "bg-transparent text-ink-2 hover:bg-paper-3 hover:text-ink"
			}`}
		>
			{children}
		</button>
	);
}
