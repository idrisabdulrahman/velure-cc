// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { priceToKobo } from "../line-money";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("#/lib/auth-hook", () => ({
	useUnifiedAuth: () => ({ data: null }),
}));
vi.mock("#/lib/supabase-session", () => ({
	useSupabaseSession: () => ({ client: null }),
}));
vi.mock("./editor/notes-editor", () => ({
	NotesEditor: () => null,
}));

import { CreateInvoicePanel } from "./create-invoice-panel";

const draft = {
	lineItems: [
		{
			name: "One",
			quantity: 1,
			price: 10.01,
			unit: "unit",
			classificationCode: "100",
		},
		{
			name: "Two",
			quantity: 2,
			price: 20.05,
			unit: "unit",
			classificationCode: "200",
		},
		{
			name: "Three",
			quantity: 3,
			price: 0.1,
			unit: "unit",
			classificationCode: "300",
		},
	],
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("invoice editor rows", () => {
	it("opens with a customer picker and no tax error", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel />
				</QueryClientProvider>,
			);
		});
		expect(container.textContent).toContain("Select customer");
		expect(container.textContent).not.toContain(
			"Complete the unit and goods/service code",
		);
		await act(async () => root.unmount());
	});

	it("renders all three priced rows and their subtotal", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel initialDraft={draft} />
				</QueryClientProvider>,
			);
		});
		const rows = container.querySelectorAll(
			'input[id^="invoice-line-description-"]',
		);
		expect(rows).toHaveLength(3);
		expect([...rows].map((row) => (row as HTMLInputElement).value)).toEqual([
			"One",
			"Two",
			"Three",
		]);
		const visibleTotals = [
			...container.querySelectorAll('[data-testid="invoice-line-total"]'),
		];
		expect(visibleTotals).toHaveLength(3);
		const subtotal = container.querySelector(
			'[data-testid="invoice-subtotal"]',
		);
		expect(subtotal).not.toBeNull();
		const displayedKobo = (node: Element) =>
			priceToKobo(node.textContent?.replace(/[^\d.,]/g, "") ?? "");
		expect(displayedKobo(subtotal as Element)).toBe(
			visibleTotals.reduce((sum, row) => sum + displayedKobo(row), 0),
		);
		const price = container.querySelector(
			'input[id^="invoice-line-price-"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(price, "11");
			price.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(
			displayedKobo(
				container.querySelector(
					'[data-testid="invoice-line-total"]',
				) as Element,
			),
		).toBe(1100);
		expect(
			displayedKobo(
				container.querySelector('[data-testid="invoice-subtotal"]') as Element,
			),
		).toBe(5140);
		const quantity = container.querySelector(
			'input[type="number"][min="1"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(quantity, "2");
			quantity.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(
			displayedKobo(
				container.querySelector(
					'[data-testid="invoice-line-total"]',
				) as Element,
			),
		).toBe(2200);
		expect(
			displayedKobo(
				container.querySelector('[data-testid="invoice-subtotal"]') as Element,
			),
		).toBe(6240);
		await act(async () => root.unmount());
	});
});
