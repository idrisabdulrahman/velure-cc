import type { ReactNode } from "react";

export function RowsEmptyGuard({
	show,
	children,
}: {
	show: boolean;
	children: ReactNode;
}) {
	if (!show) return <>{children}</>;

	return (
		<div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-rule px-4 text-center text-sm text-ink-3">
			No records for this period
		</div>
	);
}
