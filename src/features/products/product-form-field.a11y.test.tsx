// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "#/components/ui/input";
import { Field } from "./product-form-utils";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(node);
	});
	return { container, root };
}

describe("product form Field label association", () => {
	it("generates a matching id for the label and its control", async () => {
		const { container, root } = await render(
			<Field label="Product name *">
				<Input defaultValue="Battery" />
			</Field>,
		);

		const label = container.querySelector("label");
		const input = container.querySelector("input");
		expect(label?.getAttribute("for")).toBeTruthy();
		expect(input?.id).toBe(label?.getAttribute("for"));

		await act(async () => root.unmount());
	});

	it("gives sibling fields distinct ids", async () => {
		const { container, root } = await render(
			<>
				<Field label="SKU">
					<Input defaultValue="a" />
				</Field>
				<Field label="Tax ID">
					<Input defaultValue="b" />
				</Field>
			</>,
		);

		const ids = [...container.querySelectorAll("input")].map((i) => i.id);
		expect(ids.every(Boolean)).toBe(true);
		expect(new Set(ids).size).toBe(2);

		await act(async () => root.unmount());
	});

	it("keeps an explicit htmlFor and does not overwrite the control id", async () => {
		const { container, root } = await render(
			<Field label="Goods/service code *" htmlFor="product-classification-code">
				<Input id="product-classification-code" defaultValue="SVC-01" />
			</Field>,
		);

		const label = container.querySelector("label");
		const input = container.querySelector("input");
		expect(label?.getAttribute("for")).toBe("product-classification-code");
		expect(input?.id).toBe("product-classification-code");

		await act(async () => root.unmount());
	});
});
