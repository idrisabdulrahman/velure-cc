/** Clearance lifecycle states; intentionally separate from InvoiceStatus. */
export const E_INVOICE_LIFECYCLE_STATES = [
	"draft",
	"ready",
	"submitted",
	"cleared",
	"rejected",
	"sent",
	"paid",
] as const;

export type EInvoiceLifecycleState =
	(typeof E_INVOICE_LIFECYCLE_STATES)[number];

const ALLOWED_TRANSITIONS: Readonly<
	Record<EInvoiceLifecycleState, readonly EInvoiceLifecycleState[]>
> = {
	draft: ["ready"],
	ready: ["submitted"],
	submitted: ["cleared", "rejected"],
	cleared: ["sent"],
	rejected: [],
	sent: ["paid"],
	paid: [],
};

function isLifecycleState(value: string): value is EInvoiceLifecycleState {
	return (E_INVOICE_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** Returns the next state for one legal edge; it never mutates the input. */
export function transitionEInvoiceLifecycle(
	current: EInvoiceLifecycleState,
	next: EInvoiceLifecycleState,
): EInvoiceLifecycleState {
	if (!isLifecycleState(current)) {
		throw new Error(`Unknown e-invoice lifecycle state "${current}".`);
	}
	if (!isLifecycleState(next)) {
		throw new Error(`Unknown e-invoice lifecycle state "${next}".`);
	}

	const allowed = ALLOWED_TRANSITIONS[current];
	if (allowed.includes(next)) return next;
	if (allowed.length === 0) {
		throw new Error(
			`E-invoice lifecycle state "${current}" is terminal; it cannot transition to "${next}".`,
		);
	}
	throw new Error(
		`Invalid e-invoice lifecycle transition "${current}" -> "${next}". Allowed next state(s): ${allowed.join(", ")}.`,
	);
}
