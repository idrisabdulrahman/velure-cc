// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DatePicker } from "./DatePicker";

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

describe("DatePicker id uniqueness", () => {
	it("renders two pickers with distinct input ids and correct labels", async () => {
		const { container, root } = await render(
			<>
				<DatePicker label="Issue date" value="2026-01-01" onChange={() => {}} />
				<DatePicker label="Due date" value="2026-01-15" onChange={() => {}} />
			</>,
		);

		const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
		expect(inputs).toHaveLength(2);
		expect(inputs.every((input) => input.id)).toBe(true);
		expect(new Set(inputs.map((input) => input.id)).size).toBe(2);

		const labels = [...container.querySelectorAll("label")];
		expect(labels).toHaveLength(2);
		expect(labels[0]?.getAttribute("for")).toBe(inputs[0]?.id);
		expect(labels[1]?.getAttribute("for")).toBe(inputs[1]?.id);
		expect(labels[0]?.getAttribute("for")).not.toBe(
			labels[1]?.getAttribute("for"),
		);

		await act(async () => root.unmount());
	});

	it("honours an explicit id", async () => {
		const { container, root } = await render(
			<DatePicker
				id="custom-date"
				label="Custom"
				value="2026-01-01"
				onChange={() => {}}
			/>,
		);

		expect(container.querySelector("input")?.id).toBe("custom-date");
		expect(container.querySelector("label")?.getAttribute("for")).toBe(
			"custom-date",
		);

		await act(async () => root.unmount());
	});
});
