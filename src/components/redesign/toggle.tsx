import type { ReactNode } from "react";
import { useId } from "react";
import { Switch } from "#/components/ui/switch";

export type ToggleProps = {
	label: ReactNode;
	description?: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
};

export function Toggle({
	label,
	description,
	checked,
	onChange,
	disabled,
}: ToggleProps) {
	const id = useId();
	return (
		<div className="flex items-center gap-4">
			<div className="min-w-0 flex-1">
				<label htmlFor={id} className="block text-sm font-medium text-ink">
					{label}
				</label>
				{description ? (
					<p id={`${id}-desc`} className="mt-0.5 text-[12.5px] text-ink-2">
						{description}
					</p>
				) : null}
			</div>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onChange}
				disabled={disabled}
				aria-describedby={description ? `${id}-desc` : undefined}
			/>
		</div>
	);
}
