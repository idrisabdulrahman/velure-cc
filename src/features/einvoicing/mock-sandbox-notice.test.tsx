import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MockSandboxNotice } from "./mock-sandbox-notice";

describe("MockSandboxNotice", () => {
	it("labels the private environment and clearly disclaims external submission and clearance", () => {
		const markup = renderToStaticMarkup(<MockSandboxNotice />);
		expect(markup).toContain('role="note"');
		expect(markup).toContain('aria-label="Mock sandbox environment"');
		expect(markup).toContain("Mock sandbox only.");
		expect(markup).toContain(
			"No invoice is sent to or cleared by an external provider, NRS, or MBS.",
		);
	});
});
