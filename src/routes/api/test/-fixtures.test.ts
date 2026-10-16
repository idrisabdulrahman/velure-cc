import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("test fixture endpoint security contract", () => {
	it("stays opt-in, session-scoped, workspace-derived, and marker-targeted", async () => {
		const source = await readFile(
			new URL("./fixtures.ts", import.meta.url),
			"utf8",
		);

		expect(source).toContain('process.env.NODE_ENV !== "production"');
		expect(source).toContain('process.env.VELURE_ENABLE_TEST_FIXTURES === "1"');
		expect(source).toContain("getInvoiceUserContext(request)");
		expect(source).toContain("resolveActiveWorkspaceId(");
		expect(source).not.toContain("service_role");
		expect(source).not.toContain('searchParams.get("workspace');
		expect(source).toContain('eq("workspace_id", workspaceId)');
		expect(source).toContain('eq("owner_id", context.userId)');
		const markerPlaceholder = "${" + "marker}";
		expect(source).toContain(`fixture.${markerPlaceholder}@example.test`);
		expect(source).toContain(`FIXTURE-${markerPlaceholder}`);
	});
});
