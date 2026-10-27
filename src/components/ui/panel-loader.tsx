import { Spinner } from "./spinner";

export function PanelLoader({ label }: { label: string }) {
	return (
		<div
			role="status"
			aria-label={label}
			className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-sm text-ink-3"
		>
			<Spinner size={24} className="text-brand !stroke-brand" />
			<span>{label}</span>
		</div>
	);
}
