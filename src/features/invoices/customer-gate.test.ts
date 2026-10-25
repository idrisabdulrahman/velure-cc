import { describe, expect, it } from "vitest";
import {
	CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
	transitionLeavesDraft,
} from "./customer-gate";
import type { InvoiceStatus } from "./types";

/**
 * B2 — the draft→issued transition matrix (SPEC §5.B row B2, §6.2 item 7).
 * The server paths consult this before requiring a linked customer record.
 */

const ALL_STATUSES: InvoiceStatus[] = [
	"draft",
	"unpaid",
	"partially-paid",
	"paid",
	"overdue",
	"canceled",
	"scheduled",
];

describe("transitionLeavesDraft", () => {
	it("gates every exit from Draft except canceling", () => {
		for (const to of ALL_STATUSES) {
			const expected = to !== "draft" && to !== "canceled";
			expect(transitionLeavesDraft("draft", to)).toBe(expected);
		}
	});

	it("never gates transitions that start outside Draft", () => {
		for (const from of ALL_STATUSES.filter((s) => s !== "draft")) {
			for (const to of ALL_STATUSES) {
				expect(transitionLeavesDraft(from, to)).toBe(false);
			}
		}
	});

	it("specifically: draft→unpaid/overdue/paid/scheduled gated, draft→canceled not", () => {
		expect(transitionLeavesDraft("draft", "unpaid")).toBe(true);
		expect(transitionLeavesDraft("draft", "overdue")).toBe(true);
		expect(transitionLeavesDraft("draft", "paid")).toBe(true);
		expect(transitionLeavesDraft("draft", "scheduled")).toBe(true);
		expect(transitionLeavesDraft("draft", "partially-paid")).toBe(true);
		expect(transitionLeavesDraft("draft", "canceled")).toBe(false);
		expect(transitionLeavesDraft("draft", "draft")).toBe(false);
	});

	it("exports an actionable, non-compliance-claiming message", () => {
		expect(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE).toMatch(/customer/i);
		expect(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE).toMatch(/draft/i);
		expect(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE).not.toMatch(
			/compliant|clearance|nrs/i,
		);
	});
});
