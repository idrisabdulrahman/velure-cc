// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WS2 requirement 3: the seller-TIN gate is a genuine issue requirement (an
 * invoice that charges VAT cannot leave Draft without one). It must never fail
 * silently: when the issue action is blocked only by the TIN, the composer
 * exposes the explicit "Add a seller TIN before charging VAT." blocker and
 * routes the user to the compliance dialog.
 *
 * This is the one branch the classification render tests cannot reach, because
 * the blocker order reports a missing linked customer first.
 */

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hoisted = vi.hoisted(() => ({
	clients: [{ id: "client-1", name: "QA Client", email: "qa@example.test" }],
}));

vi.mock("#/lib/auth-hook", () => ({
	useUnifiedAuth: () => ({ data: { user: { id: "user-1" } } }),
}));
vi.mock("#/lib/supabase-session", () => ({
	useSupabaseSession: () => ({ client: {} }),
}));
vi.mock("#/server/data/clients", () => ({
	listClients: vi.fn(async () => hoisted.clients),
	createClient: vi.fn(async () => "client-1"),
}));
vi.mock("#/server/data/workspaces", () => ({
	// A VAT-registered seller with no stored tax id: VAT is charged, the seller
	// TIN is empty, so issuing must be blocked on the TIN alone.
	getInvoiceWorkspaceSettings: vi.fn(async () => ({
		sellerTaxStatus: "vat_registered",
	})),
}));
vi.mock("#/server/data/products", () => ({
	searchProducts: vi.fn(async () => []),
}));
vi.mock("#/server/data/invoices", () => ({
	autosaveDraft: vi.fn(async () => ({
		id: "invoice-1",
		invoiceNumber: "INV-2026-000009",
	})),
	createDraft: vi.fn(),
	getTemplateDefaults: vi.fn(async () => undefined),
	list: vi.fn(async () => []),
	saveTemplateDefaults: vi.fn(),
}));
vi.mock("./editor/notes-editor", () => ({
	NotesEditor: () => null,
}));

import { CreateInvoicePanel } from "./create-invoice-panel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	document.body.innerHTML = "";
});

async function flush() {
	for (let i = 0; i < 8; i += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

function byText(text: string) {
	return [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === text,
	);
}

describe("seller TIN gate on a VAT invoice", () => {
	it("names the missing seller TIN and keeps the compliance fix reachable", async () => {
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel
						initialDraft={{
							lineItems: [
								{
									name: "Consulting",
									quantity: 2,
									price: 1000,
									unit: "unit",
									vatCategory: "standard",
									classificationCode: "100",
								},
							],
						}}
					/>
				</QueryClientProvider>,
			);
		});
		// Let the workspace and client queries resolve.
		await flush();

		const picker = byText("Select customer");
		expect(picker).toBeDefined();
		await act(async () => {
			picker?.click();
		});

		const option = byText("QA Client");
		expect(option).toBeDefined();
		await act(async () => {
			option?.click();
		});
		await flush();

		// The only remaining issue requirement is the seller TIN, so the blocker
		// names it and the primary action is aria-disabled with that label.
		const blocked = container.querySelector(
			'[aria-label="Add a seller TIN before charging VAT."]',
		);
		expect(blocked).not.toBeNull();
		expect(container.textContent).toContain("Review and issue");
	});
});
