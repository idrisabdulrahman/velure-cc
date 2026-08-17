import type { Editor } from "@tiptap/react";
import { useRef, useState } from "react";
import {
	MdOutlineAddLink,
	MdOutlineCheck,
	MdOutlineDelete,
	MdOutlineLinkOff,
} from "react-icons/md";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { formatUrlWithProtocol } from "../../utils";
import { BubbleMenuButton } from "./bubble-menu-button";

interface LinkItemProps {
	editor: Editor;
	open: boolean;
	setOpen: (open: boolean) => void;
}

export function LinkItem({ editor, open, setOpen }: LinkItemProps) {
	const [value, setValue] = useState("");
	const isActive = editor.isActive("link");
	const inputRef = useRef<HTMLInputElement>(null);
	const linkValue = editor.getAttributes("link").href;

	const handleSubmit = () => {
		const url = formatUrlWithProtocol(value);

		if (url) {
			editor
				.chain()
				.focus()
				.extendMarkRange("link")
				.setLink({ href: url })
				.run();

			setOpen(false);
		}
	};

	return (
		<Popover modal={false} open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<div>
					<BubbleMenuButton isActive={isActive} action={() => setOpen(true)}>
						{linkValue ? (
							<MdOutlineLinkOff className="size-4" />
						) : (
							<MdOutlineAddLink className="size-4" />
						)}
					</BubbleMenuButton>
				</div>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-60 p-0" sideOffset={10}>
				<div className="flex p-1">
					<input
						ref={inputRef}
						type="text"
						placeholder="Paste a link"
						className="h-7 flex-1 bg-paper p-0.5 text-xs outline-none placeholder:text-ink-3"
						defaultValue={linkValue || ""}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								handleSubmit();
							}
						}}
					/>

					{linkValue ? (
						<Button
							size="icon"
							variant="outline"
							type="button"
							className="flex size-7 items-center border-none p-1 text-danger transition-all hover:bg-danger-soft"
							onClick={() => {
								editor.chain().focus().unsetLink().run();
								if (inputRef.current) {
									inputRef.current.value = "";
								}
								setOpen(false);
							}}
						>
							<MdOutlineDelete className="size-4" />
						</Button>
					) : (
						<Button
							size="icon"
							className="size-7"
							type="button"
							onClick={handleSubmit}
						>
							<MdOutlineCheck className="size-4" />
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
