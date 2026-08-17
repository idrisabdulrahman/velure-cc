import type { JSONContent, Editor as TiptapEditor } from "@tiptap/react";
import { useCallback, useState } from "react";
import { cn } from "#/utils/cn";
import { Editor } from "./index";

interface NotesEditorProps {
	initialContent?: JSONContent | null;
	className?: string;
	onChange?: (content?: JSONContent | null) => void;
	placeholder?: string;
	tabIndex?: number;
}

export function NotesEditor({
	initialContent,
	className,
	onChange,
	placeholder,
	tabIndex,
}: NotesEditorProps) {
	const [content, setContent] = useState<JSONContent | null | undefined>(
		initialContent,
	);

	const handleUpdate = useCallback(
		(editor: TiptapEditor) => {
			const json = editor.getJSON();
			const isEmpty = editor.state.doc.textContent.length === 0;
			const next = isEmpty ? null : json;
			setContent(next);
			onChange?.(next);
		},
		[onChange],
	);

	return (
		<Editor
			content={content}
			onUpdate={handleUpdate}
			placeholder={placeholder}
			tabIndex={tabIndex}
			className={cn(
				"text-[11px] leading-[18px] text-ink invoice-editor",
				className,
			)}
		/>
	);
}
