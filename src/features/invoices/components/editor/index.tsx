import {
	EditorContent,
	type JSONContent,
	type Editor as TiptapEditor,
	useEditor,
} from "@tiptap/react";
import { BubbleMenu } from "./extentions/bubble-menu";
import { registerExtensions } from "./extentions/register";
import "./styles.css";

interface EditorProps {
	content?: JSONContent | null;
	onUpdate?: (editor: TiptapEditor) => void;
	onBlur?: (editor: TiptapEditor) => void;
	placeholder?: string;
	tabIndex?: number;
	className?: string;
}

export function Editor({
	content,
	onUpdate,
	onBlur,
	placeholder,
	tabIndex,
	className,
}: EditorProps) {
	const editor = useEditor({
		extensions: registerExtensions({ placeholder }),
		content,
		immediatelyRender: false,
		onUpdate: onUpdate ? ({ editor }) => onUpdate(editor) : undefined,
		onBlur: onBlur ? ({ editor }) => onBlur(editor) : undefined,
		editorProps: {
			attributes: {
				class: className ?? "",
			},
		},
	});

	return (
		<>
			<BubbleMenu editor={editor} />
			<EditorContent editor={editor} tabIndex={tabIndex} />
		</>
	);
}
