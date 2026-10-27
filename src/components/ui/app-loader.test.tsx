import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppLoader } from "./app-loader";
import { PanelLoader } from "./panel-loader";

describe("loading states", () => {
	it("uses the same accessible spinner on full-screen and panel waits", () => {
		const appLoader = renderToStaticMarkup(<AppLoader />);
		const panelLoader = renderToStaticMarkup(
			<PanelLoader label="Loading invoices" />,
		);

		expect(appLoader).toContain('role="status"');
		expect(appLoader).toContain('aria-label="Loading"');
		expect(appLoader).toContain('viewBox="0 0 24 24"');
		expect(appLoader).not.toContain("h-1.5 w-40");
		expect(appLoader).not.toContain('role="progressbar"');
		expect(panelLoader).toContain('aria-label="Loading invoices"');
		expect(panelLoader).toContain('viewBox="0 0 24 24"');
		expect(panelLoader).not.toContain('role="progressbar"');
	});
});
