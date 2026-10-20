import { formatInvoiceNumber } from "#/server/data/nigeria";
import type { Supabase } from "./workspaces";

/**
 * WP8 (C1) — the ONE invoice-number authority.
 *
 * Before WP8 every number was computed in application code: each create
 * scanned `invoices` for the max sequence, then wrote
 * `workspaces.next_invoice_sequence` in a second statement. Two concurrent
 * issuances could read the same max and hand out the same number, and only
 * luck (a later unique index) caught it.
 *
 * After WP8 the authority is the database, through the two functions
 * created by supabase/migrations/20261020000000:
 *
 *   * `public.invoice_number_sequences` — one monotone row per
 *     (workspace, prefix, year);
 *   * `public.allocate_invoice_number(...)` — allocates
 *     (`greatest(last_value + 1, minimum)`) or reserves for user-chosen
 *     custom numbers (`greatest(last_value, minimum)`) in ONE atomic
 *     statement, so concurrent callers serialize and never collide; it also
 *     advances the human-facing preview `workspaces.next_invoice_sequence`
 *     monotonically, which the C1 workspace guard
 *     (20261020000001) recognises as a system write.
 *
 * The application flow is deliberately plan/commit so a validation failure
 * never burns a number:
 *
 *   1. `planInvoiceNumber(...)` — read-only: prefix, year, the workspace
 *      floor, and the user's requested number (if any) with its collision
 *      state; consumes nothing;
 *   2. `assertInvoiceInput(...)` (invoices.ts) — validate the candidate;
 *   3. `commitInvoiceNumber(...)` — the RPC, immediately before the
 *      invoices INSERT/UPDATE. Under concurrency the committed number may
 *      differ from the planned candidate; the caller must persist whatever
 *      commit returns.
 *
 * The DB unique index `(workspace_id, invoice_number)` from the same
 * migration remains the backstop for every writer, and the
 * `invoices_issued_guard_update` trigger (20261020000001) refuses to change
 * an issued invoice's number at all — see `isInvoiceIssued` below.
 */

/**
 * Mirrors `public.invoice_is_issued(r public.invoices)` (20261020000000)
 * 1:1, on the camelCase mapped shape: an invoice is issued once it has left
 * the tenant's hands — delivered/sent, or money moved against it.
 *
 * Deliberately EXCLUDED (same as the SQL):
 *   * `finalizedAt` — set by the plain create flow; a created-but-unsent
 *     invoice must stay editable;
 *   * `lifecycle.firstViewedAt` — a public token preview (often the
 *     owner's own) must not lock a draft;
 *   * a bare `status = "unpaid"` with no delivery history.
 *
 * Temporary stand-in for WP11's real lifecycle: when the lifecycle states
 * land, change BOTH bodies (here and the SQL function) together.
 */
export function isInvoiceIssued(invoice: {
	deliveredAt?: number | null;
	paidAt?: number | null;
	paymentReference?: string | null;
	paymentAmount?: number | null;
	status?: string | null;
	lifecycle?: Record<string, unknown> | null;
}): boolean {
	const lifecycle = invoice.lifecycle ?? {};
	return Boolean(
		invoice.deliveredAt ||
			invoice.paidAt ||
			invoice.paymentReference ||
			Number(invoice.paymentAmount ?? 0) > 0 ||
			invoice.status === "paid" ||
			lifecycle.sentAt ||
			lifecycle.emailDeliveredAt ||
			lifecycle.paymentReceivedAt,
	);
}

/** PREFIX-YYYY-NNNN (4–6 digits), the only number format this app issues. */
const INVOICE_NUMBER_PATTERN = /^([A-Z0-9]{2,12})-(\d{4})-(\d{4,6})$/;

/** Parse an invoice number into its parts, or null when it does not match. */
export function sequenceFromInvoiceNumber(
	invoiceNumber: string,
	prefix: string,
	year: number,
): number | null {
	const match = invoiceNumber.match(
		new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`),
	);
	if (!match || Number(match[1]) !== year) return null;
	const sequence = Number(match[2]);
	return Number.isFinite(sequence) ? sequence : null;
}

/** Format a sequence for a prefix: INV uses 6 digits, named prefixes 4. */
export function invoiceNumberForSequence(
	prefix: string,
	year: number,
	sequence: number,
) {
	return prefix === "INV"
		? formatInvoiceNumber(year, sequence)
		: `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Sanitized numbering prefix: business name or explicit prefix, else INV. */
export function resolveInvoiceNumberPrefix(
	workspace: {
		name?: string | null;
		invoice_number_mode?: string | null;
		invoice_number_prefix?: string | null;
		documentType?: string;
	} | null,
): string {
	const prefixSource =
		(workspace as { invoice_number_mode?: string } | null)
			?.invoice_number_mode === "business_name"
			? workspace?.name
			: workspace?.invoice_number_prefix;
	return (
		String(prefixSource ?? "INV")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 12) || "INV"
	);
}

/**
 * Numbering inputs of a workspace: the prefix derivation and the
 * human-facing floor the allocator must never go below.
 */
async function getWorkspaceNumbering(client: Supabase, workspaceId: string) {
	const { data, error } = await client
		.from("workspaces")
		.select(
			"name, invoice_number_mode, invoice_number_prefix, next_invoice_sequence",
		)
		.eq("id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data;
}

export type InvoiceNumberPlan = {
	workspaceId: string;
	prefix: string;
	year: number;
	/** Human-facing floor (`workspaces.next_invoice_sequence`), >= 1. */
	minimumSequence: number;
	/**
	 * The user's requested number, if one was passed: `parsed` is the
	 * PREFIX-YYYY-NNNN breakdown (used to reserve the counter), `collides`
	 * the app-level uniqueness pre-check (friendly errors; the DB unique
	 * index is the real backstop).
	 */
	requested: {
		invoiceNumber: string;
		parsed: { prefix: string; year: number; sequence: number } | null;
		collides: boolean;
	} | null;
};

export type InvoiceNumberCandidate = {
	invoiceNumber: string;
	mode: "generated" | "requested";
};

/**
 * Read-only plan for the next number: resolves the workspace prefix and
 * floor and checks a user-requested number for validity and collisions.
 * Consumes NOTHING — safe to call before validation.
 */
export async function planInvoiceNumber(
	client: Supabase,
	args: {
		workspaceId: string;
		documentType?: "standard" | "proforma";
		requestedInvoiceNumber?: string;
		/** A row may keep its own number: ignore it in the collision check. */
		exceptId?: string;
	},
): Promise<InvoiceNumberPlan> {
	const workspace = await getWorkspaceNumbering(client, args.workspaceId);
	const prefix =
		args.documentType === "proforma"
			? "PF"
			: resolveInvoiceNumberPrefix(workspace);
	const year = new Date().getFullYear();
	const minimumSequence = Math.max(
		Number(workspace?.next_invoice_sequence ?? 1),
		1,
	);

	const requestedNumber = args.requestedInvoiceNumber?.trim() ?? "";
	let requested: InvoiceNumberPlan["requested"] = null;
	if (requestedNumber) {
		const match = requestedNumber.match(INVOICE_NUMBER_PATTERN);
		let collides = false;
		if (match) {
			const { data, error } = await client
				.from("invoices")
				.select("id")
				.eq("workspace_id", args.workspaceId)
				.eq("invoice_number", requestedNumber)
				.limit(1)
				.maybeSingle();
			if (error) throw error;
			collides = data !== null && data.id !== args.exceptId;
		}
		requested = {
			invoiceNumber: requestedNumber,
			parsed: match
				? {
						prefix: match[1],
						year: Number(match[2]),
						sequence: Number(match[3]),
					}
				: null,
			collides,
		};
	}

	return {
		workspaceId: args.workspaceId,
		prefix,
		year,
		minimumSequence,
		requested,
	};
}

/**
 * Pure candidate resolution, matching the pre-WP8 behaviour: a valid,
 * collision-free requested number is honoured; anything else falls back to
 * the generated PREFIX-YYYY-NNNN from the plan's floor (a preview only —
 * `commitInvoiceNumber` decides the real number).
 */
export function candidateInvoiceNumber(
	plan: InvoiceNumberPlan,
): InvoiceNumberCandidate {
	const requested = plan.requested;
	if (
		requested &&
		!requested.collides &&
		INVOICE_NUMBER_PATTERN.test(requested.invoiceNumber)
	) {
		// Valid PREFIX-YYYY-NNNN and free in this workspace: honoured
		// verbatim; `commitInvoiceNumber` reserves its own (prefix, year)
		// counter bucket so future generated numbers stay clear of it.
		return { invoiceNumber: requested.invoiceNumber, mode: "requested" };
	}
	return {
		invoiceNumber: invoiceNumberForSequence(
			plan.prefix,
			plan.year,
			plan.minimumSequence,
		),
		mode: "generated",
	};
}

/**
 * Advance the (workspace, prefix, year) counter to at least `sequence`
 * WITHOUT consuming a value — used for user-chosen custom numbers so the
 * next generated number stays contiguous around them. No-op for numbers
 * outside the PREFIX-YYYY-NNNN format (nothing to keep the counter past).
 */
export async function reserveInvoiceNumber(
	client: Supabase,
	args: { workspaceId: string; invoiceNumber: string },
): Promise<void> {
	const match = args.invoiceNumber.match(INVOICE_NUMBER_PATTERN);
	if (!match) return;
	const { error } = await client.rpc("allocate_invoice_number", {
		p_workspace_id: args.workspaceId,
		p_prefix: match[1],
		p_year: Number(match[2]),
		p_minimum_sequence: Number(match[3]),
		p_reserve_only: true,
	});
	if (error) throw error;
}

/**
 * Consume the plan's number from the database, immediately before the
 * invoices INSERT/UPDATE. Returns the number the caller MUST persist:
 * generated candidates get the allocator's value (distinct under
 * concurrency even when two plans saw the same floor), requested numbers
 * are reserved and returned verbatim.
 */
export async function commitInvoiceNumber(
	client: Supabase,
	plan: InvoiceNumberPlan,
	candidate: InvoiceNumberCandidate,
): Promise<string> {
	if (candidate.mode === "requested") {
		await reserveInvoiceNumber(client, {
			workspaceId: plan.workspaceId,
			invoiceNumber: candidate.invoiceNumber,
		});
		return candidate.invoiceNumber;
	}
	const { data, error } = await client.rpc("allocate_invoice_number", {
		p_workspace_id: plan.workspaceId,
		p_prefix: plan.prefix,
		p_year: plan.year,
		p_minimum_sequence: plan.minimumSequence,
		p_reserve_only: false,
	});
	if (error) throw error;
	return invoiceNumberForSequence(plan.prefix, plan.year, Number(data));
}

/**
 * Friendly uniqueness pre-check before a draft keeps or changes its number.
 * The DB unique index `(workspace_id, invoice_number)` backstops races and
 * every non-application writer.
 */
export async function assertInvoiceNumberAvailable(
	client: Supabase,
	args: {
		workspaceId: string;
		invoiceNumber: string;
		exceptId?: string;
	},
) {
	const { data, error } = await client
		.from("invoices")
		.select("id")
		.eq("workspace_id", args.workspaceId)
		.eq("invoice_number", args.invoiceNumber)
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (data && data.id !== args.exceptId) {
		throw new Error("Invoice number already exists in this workspace.");
	}
}

/**
 * C1: is the human-facing "next invoice number" counter locked for this
 * workspace? It locks the moment the workspace has its first issued
 * invoice (SPEC: "not editable after the first issued invoice"). The
 * database enforces the same rule in `workspaces_invoice_sequence_guard`;
 * this answer is for the settings service and the settings UI, never the
 * only gate.
 *
 * SECURITY INVOKER in SQL: the EXISTS scan runs under the caller's own RLS,
 * so a member sees their workspace's rows and a non-member gets `false`.
 */
export async function workspaceNumberingLocked(
	client: Supabase,
	workspaceId: string,
): Promise<boolean> {
	const { data, error } = await client.rpc("has_issued_invoice", {
		p_workspace_id: workspaceId,
	});
	if (error) throw error;
	return Boolean(data);
}

/**
 * C1 settings guard: the rules for changing `workspaces.next_invoice_sequence`
 * (SPEC §5.C C1, §6.2 item 5 — "remove the editable next invoice number
 * once the first invoice is issued, or restrict to can only go up"):
 *
 *   * after the FIRST ISSUED invoice the setting is not editable at all —
 *     raising included (the DB trigger `workspaces_invoice_sequence_guard`
 *     rejects the same write for every role, so this is never the only gate);
 *   * before that, RAISING is honored;
 *   * before that, LOWERING is honored only while the proposed value stays
 *     above every sequence already assigned to an invoice row — a counter
 *     may never sit below a number a document already carries, so issued
 *     numbers can never be re-approached from below.
 *
 * Uniqueness does not depend on this guard: the allocator floors every
 * allocation at `greatest(last_value + 1, minimum)`
 * (20261020000000), so even a wrongly lowered counter can never reissue an
 * allocated number.
 */
export async function assertSequenceCounterChangeAllowed(
	client: Supabase,
	args: {
		workspaceId: string;
		current: number | null;
		proposed: number;
	},
): Promise<void> {
	if (args.current !== null && args.proposed === args.current) return;
	if (await workspaceNumberingLocked(client, args.workspaceId)) {
		throw new Error(
			"The next invoice number is locked after the first issued invoice.",
		);
	}
	if (args.current === null || args.proposed >= args.current) return;
	// Lowering: only above every sequence already assigned to a document.
	const { data, error } = await client
		.from("invoices")
		.select("invoice_number")
		.eq("workspace_id", args.workspaceId);
	if (error) throw error;
	for (const row of data ?? []) {
		// Parse the bare PREFIX-YYYY-NNNN shape: prefix/year may differ from
		// the workspace's current ones and the counter is a single scalar,
		// so every assigned sequence counts against the floor.
		const match = String(row.invoice_number).match(INVOICE_NUMBER_PATTERN);
		if (match && Number(match[3]) >= args.proposed) {
			throw new Error(
				`The next invoice number cannot go below an existing invoice number (${row.invoice_number}).`,
			);
		}
	}
}
