import { describe, expect, it, vi } from "vitest";

vi.mock("@react-pdf/renderer", () => {
	const pass = (name: string) =>
		function P({ children, style, src }: Record<string, unknown>) {
			const renderStyle = (s: Record<string, unknown> | undefined) =>
				Object.entries(s ?? {})
					.map(([k, v]) => `${k}=${String(v)}`)
					.join(",");
			const label = `[${name}${src ? ` href=${String(src)}` : ""}${style ? ` ${renderStyle(style)}` : ""}]`;
			return (
				<>
					{label}
					{children}
				</>
			);
		};
	return {
		Link: pass("link"),
		Text: pass("text"),
		View: pass("view"),
	};
});

import { renderToStaticMarkup } from "react-dom/server";
import type { EditorDoc } from "../../types";
import { formatEditorContent } from "./format";

describe("formatEditorContent (pdf)", () => {
	it("applies bold, italic and strike marks as pdf text styles", () => {
		const doc: EditorDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "b", marks: [{ type: "bold" }] },
						{ type: "text", text: " " },
						{ type: "text", text: "i", marks: [{ type: "italic" }] },
						{ type: "text", text: " " },
						{ type: "text", text: "s", marks: [{ type: "strike" }] },
					],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain("fontWeight=600");
		expect(html).toContain("fontStyle=italic");
		expect(html).toContain("textDecoration=line-through");
	});

	it("renders links with the mark href", () => {
		const doc: EditorDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "link",
							marks: [
								{ type: "link", attrs: { href: "https://midday.ai" } },
								{ type: "strike" },
							],
						},
					],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain("href=https://midday.ai");
		expect(html).toContain("color=black");
	});
});
