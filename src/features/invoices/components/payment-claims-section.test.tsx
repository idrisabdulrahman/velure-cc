// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "#/features/invoices/types";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("#/components/ui/use-toast", () => ({ toast: vi.fn() }));

import { PaymentClaimsSection } from "./payment-claims-section";

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
	status: "unpaid",
	total: 1000,
	balance: 1000,
	paymentAmount: 0,
	lineItems: [
		{ id: "li_1", name: "Consulting", quantity: 1, price: 1000, unit: "unit" },
	],
	createdAt: Date.UTC(2026, 0, 1),
	updatedAt: Date.UTC(2026, 0, 1),
};

function claim(overrides: Record<string, unknown> = {}) {
	return {
		id: "claim_1",
		invoiceId: "inv_1",
		claimedAmount: 500,
		claimReference: "ref_1",
		note: null,
		status: "claimed",
		claimedAt: 1,
		resolvedAt: null,
		resolvedBy: null,
		...overrides,
	};
}

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(claims: unknown[]) {
	const calls: FetchCall[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init });
			if (init?.method === "POST") {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			return new Response(JSON.stringify({ ok: true, claims }), {
				status: 200,
			});
		}),
	);
	return calls;
}

async function flush() {
	// React Query resolves the query, then notifies subscribers on later
	// microtasks; a couple of macrotask turns reliably flushes both.
	for (let i = 0; i < 3; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

async function renderSection(queryClient = new QueryClient()) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<PaymentClaimsSection invoice={invoice} />
			</QueryClientProvider>,
		);
	});
	// Let the initial query resolve and flush the state update.
	await flush();
	return { container, root, queryClient };
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("PaymentClaimsSection", () => {
	it("renders nothing when the invoice has no claims", async () => {
		stubFetch([]);
		const { root } = await renderSection();

		expect(document.body.textContent).toBe("");
		expect(document.querySelector("section")).toBeNull();

		await act(async () => root.unmount());
	});

	it("lists the buyer claim and asks for confirmation", async () => {
		const calls = stubFetch([claim()]);
		const { root } = await renderSection();

		expect(calls.some((call) => call.url.includes("invoiceId=inv_1"))).toBe(
			true,
		);
		const text = document.body.textContent ?? "";
		expect(text).toContain("Payment claims");
		expect(text).toContain("Awaiting your confirmation");
		expect(text).toContain("ref_1");
		// Amount is formatted with the invoice currency.
		expect(text).toContain("500");
		expect(
			[...document.querySelectorAll("button")].some((button) =>
				button.textContent?.includes("Confirm"),
			),
		).toBe(true);

		await act(async () => root.unmount());
	});

	it("posts a confirm action to the claim route", async () => {
		const calls = stubFetch([claim()]);
		const { root } = await renderSection();

		const confirm = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Confirm"),
		) as HTMLButtonElement | undefined;
		expect(confirm).toBeDefined();

		await act(async () => {
			confirm?.click();
		});
		await flush();

		const post = calls.find((call) => call.init?.method === "POST");
		expect(post).toBeDefined();
		expect(post?.url).toContain("/api/invoice/claims/claim_1");
		expect(JSON.parse(String(post?.init?.body))).toEqual({
			action: "confirm",
		});

		await act(async () => root.unmount());
	});

	it("posts a reject action for the reject button", async () => {
		const calls = stubFetch([claim()]);
		const { root } = await renderSection();

		const reject = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Reject"),
		) as HTMLButtonElement | undefined;
		expect(reject).toBeDefined();

		await act(async () => {
			reject?.click();
		});
		await flush();

		const post = calls.find((call) => call.init?.method === "POST");
		expect(JSON.parse(String(post?.init?.body))).toEqual({ action: "reject" });

		await act(async () => root.unmount());
	});

	it("hides the action buttons once a claim is resolved", async () => {
		stubFetch([claim({ status: "confirmed", resolvedAt: 2 })]);
		const { root } = await renderSection();

		const text = document.body.textContent ?? "";
		expect(text).toContain("Confirmed");
		expect(
			[...document.querySelectorAll("button")].some((button) =>
				button.textContent?.includes("Confirm"),
			),
		).toBe(false);

		await act(async () => root.unmount());
	});
});
