import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EditorDoc } from "../../types";
import { formatEditorContent } from "./format";

describe("formatEditorContent", () => {
	it("returns null when there is no content", () => {
		expect(formatEditorContent()).toBeNull();
		expect(
			renderToStaticMarkup(
				<>{formatEditorContent({ type: "doc", content: [] })}</>,
			),
		).toBe("");
	});

	it("renders plain text without markdown markers", () => {
		const doc: EditorDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "**not** bold" }],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain("**not** bold");
		expect(html).not.toContain("<strong>");
	});

	it("applies bold, italic and strike marks as classes", () => {
		const doc: EditorDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "bold",
							marks: [{ type: "bold" }],
						},
						{ type: "text", text: " " },
						{
							type: "text",
							text: "ital",
							marks: [{ type: "italic" }],
						},
						{ type: "text", text: " " },
						{
							type: "text",
							text: "gone",
							marks: [{ type: "strike" }],
						},
					],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain(
			'class="text-[length:var(--invoice-editor-size)] font-semibold"',
		);
		expect(html).toContain("italic");
		expect(html).toContain("line-through");
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
							text: "midday",
							marks: [{ type: "link", attrs: { href: "https://midday.ai" } }],
						},
					],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain('href="https://midday.ai"');
		expect(html).toContain("underline");
	});

	it("turns bare emails into mailto links and renders hard breaks", () => {
		const doc: EditorDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "hi" },
						{ type: "hardBreak" },
						{ type: "text", text: "a@b.com" },
					],
				},
			],
		};
		const html = renderToStaticMarkup(<>{formatEditorContent(doc)}</>);
		expect(html).toContain("mailto:a@b.com");
		expect(html).toContain("<br/>");
	});
});
