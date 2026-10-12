import type { ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";

export type FormFieldProps = {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	children: ReactNode;
};

export function FormField({ label, hint, error, children }: FormFieldProps) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

	let control = children;
	if (isValidElement(children)) {
		const el = children as React.ReactElement<Record<string, unknown>>;
		control = cloneElement(el, {
			...(!("id" in (el.props ?? {})) || !el.props.id ? { id } : null),
			...(describedBy ? { "aria-describedby": describedBy } : null),
			...(error ? { "aria-invalid": true } : null),
		});
	}

	return (
		<div>
			<label
				htmlFor={id}
				className="mb-1.5 block text-xs font-medium text-ink-2"
			>
				{label}
			</label>
			{control}
			{hint && !error ? (
				<p id={hintId} className="mt-1.5 text-[11.5px] text-ink-3">
					{hint}
				</p>
			) : null}
			{error ? (
				<p
					id={errorId}
					role="alert"
					className="mt-1.5 text-[11.5px] text-danger"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}
