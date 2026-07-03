import { describe, expect, it } from "vitest";
import { auditActionLiterals } from "./auditActions";

describe("audit action vocabulary", () => {
	it("allows invoice renumber audit rows", () => {
		expect(auditActionLiterals).toContain("invoice.renumbered");
	});

	it("keeps audit action literals unique", () => {
		expect(new Set(auditActionLiterals).size).toBe(auditActionLiterals.length);
	});
});
