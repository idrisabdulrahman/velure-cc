import { describe, expect, it } from "vitest";
import * as server from "../../../convex/nigeria";
import type { WithholdingCategory } from "./types";
import * as client from "./nigeria";

const EXPECTED_WHT_MATRIX: Record<
	WithholdingCategory,
	{ resident: number; nonResident: number }
> = {
	none: { resident: 0, nonResident: 0 },
	goods_materials: { resident: 2, nonResident: 0 },
	general_services: { resident: 2, nonResident: 5 },
	professional_fees: { resident: 5, nonResident: 10 },
	major_construction: { resident: 2, nonResident: 5 },
	other_construction: { resident: 5, nonResident: 10 },
	telecom_colocation: { resident: 2, nonResident: 5 },
	brokerage: { resident: 5, nonResident: 10 },
	rent_hire_lease: { resident: 10, nonResident: 10 },
};

const ALL_CATEGORIES = Object.keys(
	EXPECTED_WHT_MATRIX,
) as Array<WithholdingCategory>;

describe("Nigeria tax rule registry", () => {
	it("derives the current VAT rate from the current rule set", () => {
		const ruleSet = client.getNigeriaRuleSet(
			client.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(ruleSet).toBeDefined();
		expect(client.NIGERIA_VAT_RATE).toBe(7.5);
		expect(client.NIGERIA_VAT_RATE).toBe(ruleSet?.vatRate);
	});

	it("matches the 2026 Q1 WHT matrix for every category and residency", () => {
		for (const category of ALL_CATEGORIES) {
			const resident = client.resolveWithholdingRate({
				category,
				recipientEntityType: "corporate",
				recipientResidency: "resident",
			});
			const nonResident = client.resolveWithholdingRate({
				category,
				recipientEntityType: "corporate",
				recipientResidency: "non_resident",
			});
			expect(resident).toBe(EXPECTED_WHT_MATRIX[category].resident);
			expect(nonResident).toBe(EXPECTED_WHT_MATRIX[category].nonResident);
		}
	});

	it("lets manual overrides win over the rule table", () => {
		const rate = client.resolveWithholdingRate({
			category: "professional_fees",
			recipientEntityType: "corporate",
			recipientResidency: "resident",
			manualOverride: true,
			rate: 12.5,
		});
		expect(rate).toBe(12.5);
	});

	it("resolves legacy and unknown rule-set ids to current rates", () => {
		expect(
			client.resolveWithholdingRate({
				category: "professional_fees",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
				ruleSetVersion: "ng-nrs-2026.1",
			}),
		).toBe(5);
		expect(
			client.resolveWithholdingRate({
				category: "professional_fees",
				recipientEntityType: "corporate",
				recipientResidency: "non_resident",
				ruleSetVersion: "not-a-real-version",
			}),
		).toBe(10);
	});

	it("classifies stored versions for display", () => {
		expect(
			client.classifyNigeriaRuleSetVersion(client.NIGERIA_TAX_RULE_SET_VERSION),
		).toBe("current");
		expect(client.classifyNigeriaRuleSetVersion("ng-nrs-2026.1")).toBe(
			"legacy_alias",
		);
		expect(client.classifyNigeriaRuleSetVersion("NG-2026-v1")).toBe(
			"legacy_alias",
		);
		expect(client.classifyNigeriaRuleSetVersion("garbage")).toBe("unknown");
		expect(client.classifyNigeriaRuleSetVersion(null)).toBe("unknown");
	});

	it("normalizes legacy ids to the canonical id", () => {
		expect(client.resolveNigeriaRuleSetId("ng-nrs-2026.1")).toBe(
			client.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(client.resolveNigeriaRuleSetId("NG-2026-v1")).toBe(
			client.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(
			client.resolveNigeriaRuleSetId(client.NIGERIA_TAX_RULE_SET_VERSION),
		).toBe(client.NIGERIA_TAX_RULE_SET_VERSION);
	});

	it("recognizes known versions including legacy aliases", () => {
		expect(
			client.isKnownNigeriaRuleSetVersion(client.NIGERIA_TAX_RULE_SET_VERSION),
		).toBe(true);
		expect(client.isKnownNigeriaRuleSetVersion("ng-nrs-2026.1")).toBe(true);
		expect(client.isKnownNigeriaRuleSetVersion("NG-2026-v1")).toBe(true);
		expect(client.isKnownNigeriaRuleSetVersion("garbage")).toBe(false);
		expect(client.isKnownNigeriaRuleSetVersion(undefined)).toBe(false);
	});

	it("normalizes aliases and rejects unknown versions at the write boundary", () => {
		expect(client.normalizeRuleSetVersionForWrite("ng-nrs-2026.1")).toBe(
			client.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(
			client.normalizeRuleSetVersionForWrite(
				client.NIGERIA_TAX_RULE_SET_VERSION,
			),
		).toBe(client.NIGERIA_TAX_RULE_SET_VERSION);
		expect(() => client.normalizeRuleSetVersionForWrite("garbage")).toThrow(
			/Unknown Nigeria tax rule set/,
		);
		expect(() => client.normalizeRuleSetVersionForWrite(undefined)).toThrow(
			/A Nigeria tax rule set version is required/,
		);
		expect(() => client.normalizeRuleSetVersionForWrite(null)).toThrow(
			/A Nigeria tax rule set version is required/,
		);
	});

	it("keeps registry invariants: one current rule set covering every category", () => {
		const currentSets = client.NIGERIA_TAX_RULE_SETS.filter(
			(ruleSet) => ruleSet.id === client.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(currentSets).toHaveLength(1);
		expect(currentSets[0].effectiveTo).toBeUndefined();
		for (const category of ALL_CATEGORIES) {
			const table = currentSets[0].withholdingRates[category];
			expect(table.resident).toBeGreaterThanOrEqual(0);
			expect(table.resident).toBeLessThanOrEqual(100);
			expect(table.nonResident).toBeGreaterThanOrEqual(0);
			expect(table.nonResident).toBeLessThanOrEqual(100);
		}
	});
});

describe("Convex source and client mirror parity", () => {
	it("agrees on the rule registry, rates, and version handling", () => {
		expect(client.NIGERIA_TAX_RULE_SET_VERSION).toBe(
			server.NIGERIA_TAX_RULE_SET_VERSION,
		);
		expect(client.NIGERIA_VAT_RATE).toBe(server.NIGERIA_VAT_RATE);
		expect(client.NIGERIA_AUTHORITY_LABEL).toBe(server.NIGERIA_AUTHORITY_LABEL);
		expect(client.NIGERIA_TAX_RULE_SETS).toEqual(server.NIGERIA_TAX_RULE_SETS);

		for (const category of ALL_CATEGORIES) {
			expect(
				client.resolveWithholdingRate({
					category,
					recipientEntityType: "corporate",
					recipientResidency: "resident",
				}),
			).toBe(
				server.resolveWithholdingRate({
					category,
					recipientResidency: "resident",
				}),
			);
			expect(
				client.resolveWithholdingRate({
					category,
					recipientEntityType: "corporate",
					recipientResidency: "non_resident",
				}),
			).toBe(
				server.resolveWithholdingRate({
					category,
					recipientResidency: "non_resident",
				}),
			);
		}

		for (const version of [
			"ng-nrs-2026.1",
			"NG-2026-v1",
			client.NIGERIA_TAX_RULE_SET_VERSION,
			"garbage",
			null,
		]) {
			expect(client.classifyNigeriaRuleSetVersion(version)).toBe(
				server.classifyNigeriaRuleSetVersion(version),
			);
			expect(client.resolveNigeriaRuleSetId(version)).toBe(
				server.resolveNigeriaRuleSetId(version),
			);
			expect(client.isKnownNigeriaRuleSetVersion(version)).toBe(
				server.isKnownNigeriaRuleSetVersion(version),
			);
		}
	});
});
