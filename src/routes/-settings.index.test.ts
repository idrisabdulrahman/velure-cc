import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * B1 save-flow contract for the settings page (audit round 1).
 *
 * This repo has no component-test harness (node test environment, no
 * testing-library), so the UI wiring rules behind the audit findings are
 * pinned against the route source instead:
 *
 * 1. a successful save recomputes the flagged-for-review banner instead of
 *    leaving the pre-save flag in the query cache;
 * 2. a cleared LGA is sent to the server as an explicit empty string (the
 *    server treats `undefined` as "keep the stored value").
 */

const source = readFileSync(
	fileURLToPath(new URL("./settings.index.tsx", import.meta.url)),
	"utf8",
);

const saveStart = source.indexOf("await upsertWorkspaceSettings");

describe("settings supplier profile save flow", () => {
	it("recomputes the validation-flag banner after a successful save", () => {
		expect(saveStart).toBeGreaterThan(-1);
		const recompute = source.indexOf("setSavedProfile(", saveStart);
		const refresh = source.indexOf("await refetchSettings()", saveStart);
		const successToast = source.indexOf('title: "Profile updated"', saveStart);
		expect(recompute).toBeGreaterThan(saveStart);
		expect(refresh).toBeGreaterThan(recompute);
		expect(successToast).toBeGreaterThan(refresh);
	});

	it("derives the banner from the shared recomputation helper", () => {
		expect(source).toContain("supplierProfileBanner(");
	});

	it("sends a cleared LGA as an explicit empty string, never undefined", () => {
		expect(source).toContain("addressLga: form.addressLga.trim(),");
		expect(source).not.toContain(
			"addressLga: form.addressLga.trim() || undefined",
		);
	});

	it("caps the structured address inputs at the DB CHECK lengths", () => {
		expect(source).toContain("maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.street}");
		expect(source).toContain("maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.lga}");
		expect(source).toContain("maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.state}");
	});

	it("shows neutral setup copy for a never-saved workspace, not the flagged wording", () => {
		expect(source).toContain("profileBanner.setupRequired");
		expect(source).toContain("Complete your business profile");
	});

	it("surfaces server profile-rejection messages instead of a generic toast", () => {
		expect(source).toContain("SUPPLIER_PROFILE_REJECTION_PREFIX");
		expect(source).toContain('"Check your registration details"');
	});
});
