// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "#/features/invoices/types";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("#/lib/auth-hook", () => ({
	useUnifiedAuth: () => ({ data: null }),
}));
vi.mock("#/lib/supabase-session", () => ({
	useSupabaseSession: () => ({ client: null }),
}));
vi.mock("#/features/invoices/components/editor/notes-editor", () => ({
	NotesEditor: () => null,
}));
vi.mock("#/server/data/workspaces", () => ({
	getInvoiceWorkspaceSettings: vi.fn(),
}));
vi.mock("#/server/data/invoices", () => ({
	cancelSchedule: vi.fn(),
	reschedule: vi.fn(),
}));

import { InvoiceDetailsSheet } from "./invoice-details-sheet";

const invoice: InvoiceRecord = {
	id: "inv_1",
	token: "tok_1",
	invoiceNumber: "INV-0001",
	customerName: "Acme Ltd",
	currency: "NGN",
	type: "one-time",
	invoiceSize: "A4",
	dateFormat: "ng",
	paymentTermsDays: 14,
	template: "Default",
	issueDate: "2026-01-01",
	dueDate: "2026-01-15",
	status: "draft",
	total: 1000,
	balance: 1000,
	paymentAmount: 0,
	lineItems: [
		{ id: "li_1", name: "Consulting", quantity: 1, price: 1000, unit: "unit" },
	],
	createdAt: Date.UTC(2026, 0, 1),
	updatedAt: Date.UTC(2026, 0, 1),
};

async function renderSheet() {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<InvoiceDetailsSheet
					open
					onOpenChange={() => undefined}
					invoice={invoice}
					onSave={() => undefined}
				/>
			</QueryClientProvider>,
		);
	});
	return { container, root };
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("invoice details sheet label association", () => {
	it("associates every visible label with an existing control", async () => {
		const { root } = await renderSheet();

		const labels = [...document.querySelectorAll("label[for]")];
		expect(labels.length).toBeGreaterThan(0);

		for (const label of labels) {
			const target = label.getAttribute("for");
			expect(target).toBeTruthy();
			const control = document.getElementById(target as string);
			expect(
				control,
				`label "${label.textContent}" -> #${target}`,
			).not.toBeNull();
		}

		await act(async () => root.unmount());
	});

	it("gives each date picker a unique input id", async () => {
		const { root } = await renderSheet();

		const dateInputs = [
			...document.querySelectorAll<HTMLInputElement>("input.pr-9"),
		];
		expect(dateInputs.length).toBeGreaterThanOrEqual(2);

		const ids = dateInputs.map((input) => input.id).filter(Boolean);
		expect(ids.length).toBe(dateInputs.length);
		expect(new Set(ids).size).toBe(ids.length);

		// The visible "Issue date" / "Due date" labels must resolve to the pickers.
		const dateLabels = [...document.querySelectorAll("label[for]")].filter(
			(label) =>
				["Issue date", "Due date"].includes(label.textContent?.trim() ?? ""),
		);
		expect(dateLabels).toHaveLength(2);
		const labeledInputs = dateLabels.map((label) =>
			document.getElementById(label.getAttribute("for") as string),
		);
		for (const input of labeledInputs) {
			expect(input?.className).toContain("pr-9");
		}
		expect(new Set(labeledInputs.map((input) => input?.id)).size).toBe(2);

		await act(async () => root.unmount());
	});
});
