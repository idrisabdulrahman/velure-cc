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

/**
 * The panel opens with `taxTreatment: "none"`, the same state a seller whose
 * tax status charges no VAT lands in. The server still requires a unit, VAT
 * category and goods/service code on every finalized line
 * (`assertCustomerForIssueTransition` → `lineMissingClassification`), so the
 * row must stay reachable in that state. It used to be hidden behind
 * `isVatEnabled`, which made the server's rejection impossible to act on.
 */
describe("line classification on a no-VAT invoice", () => {
	const oneLine = {
		lineItems: [
			{
				name: "Solar panel",
				quantity: 1,
				price: 155,
				unit: undefined,
				classificationCode: undefined,
			},
		],
	};

	it("keeps the unit / VAT category / code controls reachable", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel initialDraft={oneLine} />
				</QueryClientProvider>,
			);
		});

		const toggle = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Unit · Choose unit"),
		);
		expect(toggle).toBeDefined();
		expect(toggle?.textContent).toContain("Code · Add code");
		// The row used to carry `hidden` whenever the invoice charged no VAT.
		expect(toggle?.className).not.toContain("hidden");

		await act(async () => toggle?.click());

		expect(container.textContent).toContain("Unit of measure");
		expect(container.textContent).toContain("VAT category");
		expect(container.textContent).toContain("Goods/service code");

		await act(async () => root.unmount());
	});
});

/**
 * P1 fix: the first invoice used to hide the classification step behind an
 * undisclosed disclosure and expose a single ambiguous "Create" action, so a
 * draft could not be saved without it. The outcomes are now explicit - Save
 * draft, Review and issue, Send - and the missing fields are named at the line.
 */
describe("draft and issue actions are explicit", () => {
	const oneUnclassifiedLine = {
		lineItems: [{ name: "Solar panel", quantity: 1, price: 155 }],
	};

	function renderPanel() {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		return { container, root };
	}

	function issueButton(container: HTMLElement) {
		return [...container.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Review and issue",
		);
	}

	it("offers Save draft for a priced line with no classification", async () => {
		const { container, root } = renderPanel();
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel initialDraft={oneUnclassifiedLine} />
				</QueryClientProvider>,
			);
		});

		const saveDraft = container.querySelector<HTMLButtonElement>(
			'[data-testid="invoice-save-draft"]',
		);
		expect(saveDraft).not.toBeNull();
		expect(saveDraft?.disabled).toBe(false);

		const issue = issueButton(container);
		expect(issue).toBeDefined();
		// Issue still leaves Draft, so it stays blocked until classified.
		expect(issue?.getAttribute("aria-disabled")).toBe("true");

		await act(async () => root.unmount());
	});

	it("names the missing line fields and links to Tax & compliance when issue is blocked", async () => {
		const { container, root } = renderPanel();
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<CreateInvoicePanel initialDraft={oneUnclassifiedLine} />
				</QueryClientProvider>,
			);
		});

		await act(async () => issueButton(container)?.click());

		expect(container.textContent).toContain(
			"This line needs unit and goods/service code before",
		);
		expect(container.textContent).toContain("Open tax & compliance");

		await act(async () => root.unmount());
	});
});
