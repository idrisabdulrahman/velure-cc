// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #3 finding 4: sharing friction. A quick-created customer may be a name
 * alone; email is required only to email-deliver an invoice, so the inline
 * composer form must not block on it and must not mark the field required.
 */

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hoisted = vi.hoisted(() => ({
	createClient: vi.fn(
		async (
			_client: unknown,
			_userId: string,
			_args: { name?: string; email?: string },
		) => "client-1",
	),
	createDraft: vi.fn(),
}));

vi.mock("#/lib/auth-hook", () => ({
	useUnifiedAuth: () => ({ data: { user: { id: "user-1" } } }),
}));
vi.mock("#/lib/supabase-session", () => ({
	useSupabaseSession: () => ({ client: {} }),
}));
vi.mock("#/server/data/clients", () => ({
	listClients: vi.fn(async () => []),
	createClient: hoisted.createClient,
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
	hoisted.createClient.mockClear();
	hoisted.createDraft.mockReset();
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

/** React ignores a plain `el.value = x`; use the native setter + input event. */
function typeInto(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("quick-create customer without an email (issue #3)", () => {
	it("creates a name-only customer and does not require the email field", async () => {
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel
						initialDraft={{
							lineItems: [{ name: "Consulting", quantity: 1, price: 1000 }],
						}}
					/>
				</QueryClientProvider>,
			);
		});
		await flush();

		await act(async () => {
			byText("Select customer")?.click();
		});
		await flush();
		await act(async () => {
			byText("Create customer")?.click();
		});
		await flush();

		const emailInput =
			document.querySelector<HTMLInputElement>("#new-client-email");
		expect(emailInput).not.toBeNull();
		expect(emailInput?.required).toBe(false);

		const nameInput =
			document.querySelector<HTMLInputElement>("#new-client-name");
		expect(nameInput).not.toBeNull();
		await act(async () => {
			typeInto(nameInput as HTMLInputElement, "Name Only Co");
		});
		await flush();

		const form = nameInput?.closest("form");
		expect(form).not.toBeNull();
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});
		await flush();

		expect(hoisted.createClient).toHaveBeenCalledTimes(1);
		const args = hoisted.createClient.mock.calls[0]?.[2];
		expect(args?.name).toBe("Name Only Co");
		expect(args?.email).toBe("");
		expect(hoisted.createDraft).not.toHaveBeenCalled();
	});
});
