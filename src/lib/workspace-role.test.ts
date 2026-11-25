import { describe, expect, it } from "vitest";
import { canMutateWorkspace, isWorkspaceViewer } from "./workspace-role";

/**
 * WP-E — the UI's read/write decision. RLS is the enforcement boundary; these
 * helpers only decide which affordances render. The important edge case is the
 * unresolved role (`null`, before the workspace context query settles): it must
 * never be treated as "a viewer" (which would hide controls from an owner
 * mid-load) and never as "allowed" for writes either — it is simply not a
 * viewer, and `canMutateWorkspace` is false.
 */
describe("workspace role helpers", () => {
	it("lets the owner and a plain member mutate", () => {
		expect(canMutateWorkspace("owner")).toBe(true);
		expect(canMutateWorkspace("member")).toBe(true);
	});

	it("never lets a viewer mutate", () => {
		expect(canMutateWorkspace("viewer")).toBe(false);
		expect(isWorkspaceViewer("viewer")).toBe(true);
	});

	it("treats an unresolved or absent role as not-a-viewer and not-a-writer", () => {
		for (const role of [null, undefined] as const) {
			expect(canMutateWorkspace(role)).toBe(false);
			expect(isWorkspaceViewer(role)).toBe(false);
		}
	});
});
