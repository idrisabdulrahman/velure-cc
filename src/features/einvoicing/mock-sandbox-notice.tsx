/** Persistent copy for the mock-only provider surface. */
export function MockSandboxNotice() {
	return (
		<aside
			role="note"
			aria-label="Mock sandbox environment"
			className="rounded-md border border-warn-line/35 bg-warn-soft px-4 py-3 text-sm leading-6 text-warn"
		>
			<strong className="font-semibold">Mock sandbox only.</strong> No invoice
			is sent to or cleared by an external provider, NRS, or MBS.
		</aside>
	);
}
