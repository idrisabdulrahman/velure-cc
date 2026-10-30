// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResizeObserver } from "./use-resize-observer";

/* Regression guard for the public invoice page bug: the observed element
 * mounts after the first render (the page renders a loader and returns early),
 * so the mount-time effect sees a null ref. Before the fix the observer never
 * attached, `entry` stayed undefined, and callers fell back to an unmeasured
 * size, which pushed a 595px invoice paper off every phone viewport. */

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Observed = { element: Element; width: number };

let observed: Observed[] = [];

class FakeResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}

	observe(element: Element) {
		const width = 280;
		observed.push({ element, width });
		this.callback(
			[
				{
					contentRect: { width, height: 396 },
					target: element,
				} as unknown as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver,
		);
	}

	unobserve() {}
	disconnect() {}
}

function Harness({
	mount,
	report,
}: {
	mount: boolean;
	report: (entry: ResizeObserverEntry | undefined) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const entry = useResizeObserver(ref);

	report(entry);

	return mount ? <div ref={ref} data-testid="stage" /> : null;
}

describe("useResizeObserver", () => {
	beforeEach(() => {
		observed = [];
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("attaches to the element once it mounts after the first render", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		const seen: Array<ResizeObserverEntry | undefined> = [];

		await act(async () => {
			root.render(
				<Harness mount={false} report={(entry) => seen.push(entry)} />,
			);
		});

		expect(seen.at(-1)).toBeUndefined();
		expect(observed).toHaveLength(0);

		await act(async () => {
			root.render(<Harness mount report={(entry) => seen.push(entry)} />);
		});

		expect(observed).toHaveLength(1);
		expect(observed[0]?.element).toBe(
			container.querySelector("[data-testid=stage]"),
		);
		expect(seen.at(-1)?.contentRect.width).toBe(280);

		await act(async () => {
			root.unmount();
		});
	});
});
