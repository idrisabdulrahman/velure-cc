import { useEffect, useState } from "react";
import { cn } from "#/utils/cn";

export function InlineLabelInput({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<input
			type="text"
			value={draft}
			maxLength={80}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => onChange(draft.trim() || value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
			}}
			aria-label={`Edit ${value} label`}
			className={cn(
				"min-w-0 bg-transparent p-0 text-inherit outline-none focus:text-ink",
				className,
			)}
		/>
	);
}
