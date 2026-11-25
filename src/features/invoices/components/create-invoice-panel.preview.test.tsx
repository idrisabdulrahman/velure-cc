// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #3 finding 2: the primary action must not finalize on one click.
 * "Preview invoice" opens a read-only document; only the explicit confirm
 * ("Issue invoice") persists. This test reaches the enabled issue state through
 * the same client picker the TIN test uses, then proves the two clicks apart.
 */

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hoisted = vi.hoisted(() => ({
	clients: [{ id: "client-1", name: "QA Client", email: "qa@example.test" }],
	createDraft: vi.fn(),
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
	getInvoiceWorkspaceSettings: vi.fn(async () => ({})),
}));
vi.mock("#/server/data/products", () => ({
	searchProducts: vi.fn(async () => []),
}));
vi.mock("#/server/data/invoices", () => ({
	autosaveDraft: vi.fn(async () => ({
		id: "invoice-1",
		invoiceNumber: "INV-2026-000009",
	})),
	createDraft: hoisted.createDraft,
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
	hoisted.createDraft.mockReset();
	hoisted.createDraft.mockResolvedValue({
		id: "invoice-1",
		token: "pub-token-1",
		documentType: "standard",
		invoiceNumber: "INV-2026-000010",
		dueDate: "2026-03-01",
		customerName: "QA Client",
	});
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

async function renderReadyPanel() {
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
	await flush();

	const picker = byText("Select customer");
	await act(async () => {
		picker?.click();
	});
	const option = byText("QA Client");
	await act(async () => {
		option?.click();
	});
	await flush();
}

describe("preview before issue (issue #3)", () => {
	it("opens a read-only preview without persisting, then issues only on confirm", async () => {
		await renderReadyPanel();

		const preview = byText("Preview invoice");
		expect(preview).toBeDefined();
		await act(async () => {
			preview?.click();
		});
		await flush();

		// Nothing was created by opening the preview.
		expect(hoisted.createDraft).not.toHaveBeenCalled();

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog?.textContent).toContain(
			"Nothing is saved or sent until you confirm",
		);

		const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent?.trim() === "Issue invoice",
		);
		expect(confirm).toBeDefined();
		await act(async () => {
			confirm?.click();
		});
		await flush();

		expect(hoisted.createDraft).toHaveBeenCalledTimes(1);
	});
});
