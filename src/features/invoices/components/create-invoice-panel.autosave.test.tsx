// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for the live QA finding "Draft saved can appear while the latest
 * change is not saved" (see prompts/invoice-draft-autosave-fix-2026-11.md).
 *
 * The panel must (a) stop saying "Draft saved" the moment an edit is ahead of
 * the last persisted draft, and (b) persist the newest edit even when it lands
 * while an earlier autosave request is still in flight.
 */

const hoisted = vi.hoisted(() => ({
	autosaveDraft: vi.fn(),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("#/lib/auth-hook", () => ({
	useUnifiedAuth: () => ({ data: { user: { id: "user-1" } } }),
}));
vi.mock("#/lib/supabase-session", () => ({
	useSupabaseSession: () => ({ client: {} }),
}));
vi.mock("#/server/data/clients", () => ({
	listClients: vi.fn(async () => []),
	createClient: vi.fn(async () => "client-1"),
}));
vi.mock("#/server/data/workspaces", () => ({
	getInvoiceWorkspaceSettings: vi.fn(async () => undefined),
}));
vi.mock("#/server/data/products", () => ({
	searchProducts: vi.fn(async () => []),
}));
vi.mock("#/server/data/invoices", () => ({
	autosaveDraft: hoisted.autosaveDraft,
	createDraft: vi.fn(),
	getTemplateDefaults: vi.fn(async () => undefined),
	list: vi.fn(async () => []),
	saveTemplateDefaults: vi.fn(),
}));
vi.mock("./editor/notes-editor", () => ({
	NotesEditor: () => null,
}));

import { CreateInvoicePanel } from "./create-invoice-panel";

const initialDraft = {
	invoiceNumber: "INV-2026-000009",
	customerName: "QA Client",
	customerEmail: "qa@example.test",
	lineItems: [
		{
			name: "Consulting",
			quantity: 1,
			price: 10.01,
			unit: "pcs",
			classificationCode: "100",
		},
	],
};

function deferred() {
	let resolve!: (value: unknown) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

function statusText() {
	return (
		container.querySelector('[data-testid="invoice-autosave-status"]')
			?.textContent ?? ""
	);
}

function quantityInput() {
	return container.querySelector(
		'input[type="number"][min="1"]',
	) as HTMLInputElement;
}

async function setQuantity(value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(quantityInput(), value);
		quantityInput().dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
	// The debounce callback is `void persist(...)`, so the async save is not
	// awaited by the timer flush; drain its continuation explicitly.
	await flush();
}

async function flush() {
	for (let i = 0; i < 8; i += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	hoisted.autosaveDraft.mockReset();
	hoisted.autosaveDraft.mockResolvedValue({
		id: "invoice-1",
		invoiceNumber: "INV-2026-000009",
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	vi.useRealTimers();
	document.body.innerHTML = "";
});

async function render() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<CreateInvoicePanel initialDraft={initialDraft} />
			</QueryClientProvider>,
		);
	});
	// Let the debounce fire once so the initial draft is persisted ("saved").
	await advance(1200);
}

describe("invoice draft autosave status", () => {
	it("stops claiming 'Draft saved' immediately after an edit and persists the newest quantity", async () => {
		await render();
		expect(statusText()).toBe("Draft saved");

		const save = deferred();
		hoisted.autosaveDraft.mockClear();
		hoisted.autosaveDraft.mockImplementation(() => save.promise);

		await setQuantity("2");
		// The regression: the status must not still read "Draft saved".
		expect(statusText()).not.toBe("Draft saved");
		expect(statusText()).toBe("Saving...");

		await advance(1200);
		expect(hoisted.autosaveDraft).toHaveBeenCalledTimes(1);
		expect(hoisted.autosaveDraft.mock.calls[0][2].lineItems[0].quantity).toBe(
			2,
		);

		await act(async () => {
			save.resolve({ id: "invoice-1", invoiceNumber: "INV-2026-000009" });
		});
		await flush();
		expect(statusText()).toBe("Draft saved");
	});

	it("persists an edit that lands while the previous save is in flight", async () => {
		await render();
		hoisted.autosaveDraft.mockClear();

		const inFlight = deferred();
		hoisted.autosaveDraft.mockImplementation(() => inFlight.promise);

		await setQuantity("2");
		await advance(1200);
		expect(hoisted.autosaveDraft).toHaveBeenCalledTimes(1);
		expect(hoisted.autosaveDraft.mock.calls[0][2].lineItems[0].quantity).toBe(
			2,
		);

		// A newer edit arrives while the qty=2 request is still pending.
		await setQuantity("3");
		await advance(1200);
		expect(statusText()).toBe("Saving...");
		expect(hoisted.autosaveDraft).toHaveBeenCalledTimes(1);

		await act(async () => {
			inFlight.resolve({ id: "invoice-1", invoiceNumber: "INV-2026-000009" });
		});
		await flush();
		await flush();

		// The follow-up save must carry qty=3, not the stale qty=2 snapshot.
		expect(hoisted.autosaveDraft).toHaveBeenCalledTimes(2);
		expect(
			hoisted.autosaveDraft.mock.calls.at(-1)?.[2].lineItems[0].quantity,
		).toBe(3);
	});

	it("guards unload while a change is unsaved and clears once it is saved", async () => {
		await render();

		const savedLeave = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(savedLeave);
		expect(savedLeave.defaultPrevented).toBe(false);

		const save = deferred();
		hoisted.autosaveDraft.mockImplementation(() => save.promise);
		await setQuantity("2");

		const pendingLeave = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(pendingLeave);
		expect(pendingLeave.defaultPrevented).toBe(true);

		await advance(1200);
		await act(async () => {
			save.resolve({ id: "invoice-1", invoiceNumber: "INV-2026-000009" });
		});
		await flush();

		const cleanLeave = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(cleanLeave);
		expect(cleanLeave.defaultPrevented).toBe(false);
	});
});
