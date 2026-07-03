"use client";

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
					? "bg-[#1a2117] text-[#c8ff62]"
					: "bg-transparent text-[#d8d1c4] hover:bg-[#151817]"
			}`}
		>
			{children}
		</button>
	);
}
