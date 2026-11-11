import { describe, expect, it } from "vitest";
import { VAT_CATEGORY_OPTIONS } from "#/features/products/product-form-utils";
import {
	CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
	lineMissingClassification,
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

/**
 * B3 — the line-classification rule is shared by the server gate and the
 * composer. It used to be applied by the composer only when the invoice charged
 * VAT, while the server demanded it for every finalize, so a seller whose tax
 * treatment applies no VAT got a rejection for fields the form never showed.
 */
describe("lineMissingClassification", () => {
	const complete = {
		unit: "pcs",
		vatCategory: "exempt",
		classificationCode: "123456",
	};

	it("accepts a fully classified line of any VAT category", () => {
		for (const vatCategory of ["standard", "zero_rated", "exempt"]) {
			expect(lineMissingClassification({ ...complete, vatCategory })).toBe(
				false,
			);
		}
	});

	it("rejects a missing unit, category or code regardless of tax treatment", () => {
		expect(lineMissingClassification({ ...complete, unit: "" })).toBe(true);
		expect(lineMissingClassification({ ...complete, unit: undefined })).toBe(
			true,
		);
		expect(
			lineMissingClassification({ ...complete, classificationCode: "  " }),
		).toBe(true);
		expect(
			lineMissingClassification({ ...complete, vatCategory: undefined }),
		).toBe(true);
		expect(lineMissingClassification({ ...complete, vatCategory: "" })).toBe(
			true,
		);
	});

	it("rejects an unsupported VAT category", () => {
		expect(
			lineMissingClassification({ ...complete, vatCategory: "reduced" }),
		).toBe(true);
	});

	it("accepts the categories the composer offers", () => {
		for (const option of VAT_CATEGORY_OPTIONS) {
			expect(
				lineMissingClassification({ ...complete, vatCategory: option.value }),
			).toBe(false);
		}
	});
});
