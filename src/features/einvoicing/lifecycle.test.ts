import { describe, expect, it } from "vitest";
import type { InvoiceStatus } from "../invoices/types";
import {
	E_INVOICE_LIFECYCLE_STATES,
	type EInvoiceLifecycleState,
	transitionEInvoiceLifecycle,
} from "./lifecycle";

const ALLOWED_EDGES: ReadonlyArray<
	readonly [EInvoiceLifecycleState, EInvoiceLifecycleState]
> = [
	["draft", "ready"],
	["ready", "submitted"],
	["submitted", "cleared"],
	["submitted", "rejected"],
	["cleared", "sent"],
	["sent", "paid"],
];

describe("e-invoice lifecycle", () => {
	it("defines exactly the clearance lifecycle states", () => {
		expect(E_INVOICE_LIFECYCLE_STATES).toEqual([
			"draft",
			"ready",
			"submitted",
			"cleared",
			"rejected",
			"sent",
			"paid",
		]);
	});

	it.each(ALLOWED_EDGES)("allows %s -> %s", (current, next) => {
		expect(transitionEInvoiceLifecycle(current, next)).toBe(next);
	});

	it("rejects every skip, backward, duplicate, and terminal transition", () => {
		const allowed = new Set(ALLOWED_EDGES.map(([from, to]) => `${from}:${to}`));
		for (const current of E_INVOICE_LIFECYCLE_STATES) {
			for (const next of E_INVOICE_LIFECYCLE_STATES) {
				if (allowed.has(`${current}:${next}`)) continue;
				let state = current;
				expect(() => {
					state = transitionEInvoiceLifecycle(current, next);
				}).toThrow();
				expect(state).toBe(current);
			}
		}
	});

	it("reports actionable terminal-state failures", () => {
		expect(() => transitionEInvoiceLifecycle("rejected", "ready")).toThrow(
			/rejected.*terminal/,
		);
		expect(() => transitionEInvoiceLifecycle("paid", "draft")).toThrow(
			/paid.*terminal/,
		);
	});

	it("rejects operational invoice statuses as lifecycle states", () => {
		const operationalStatus: InvoiceStatus = "unpaid";
		expect(() =>
			transitionEInvoiceLifecycle(
				operationalStatus as EInvoiceLifecycleState,
				"ready",
			),
		).toThrow('Unknown e-invoice lifecycle state "unpaid".');
	});
});
