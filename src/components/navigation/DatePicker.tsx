"use client";

import { CalendarIcon } from "lucide-react";
import * as React from "react";

import { Calendar } from "#/components/ui/calendar";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

function toDate(value: string): Date | undefined {
	if (!value) return undefined;
	const d = new Date(value + "T00:00:00");
	return isNaN(d.getTime()) ? undefined : d;
}

function toIso(date: Date | undefined): string {
	if (!date) return "";
	return date.toLocaleDateString("en-CA");
}

function formatDisplay(date: Date | undefined): string {
	if (!date) return "";
	return date.toLocaleDateString("en-US", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	});
}

type DatePickerProps = {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	id?: string;
	placeholder?: string;
	className?: string;
};

export function DatePicker({
	value,
	onChange,
	label,
	id,
	placeholder,
	className,
}: DatePickerProps) {
	const [open, setOpen] = React.useState(false);
	const date = toDate(value);
	const [month, setMonth] = React.useState<Date | undefined>(date);
	const [inputValue, setInputValue] = React.useState(formatDisplay(date));

	React.useEffect(() => {
		setInputValue(formatDisplay(toDate(value)));
	}, [value]);

	const inputId = id ?? "date-picker-input";

	return (
		<div className={cn("relative", className)}>
			{label && <Label htmlFor={inputId}>{label}</Label>}
			<div className="relative mt-1.5">
				<Input
					id={inputId}
					value={inputValue}
					placeholder={placeholder ?? "Select a date"}
					onChange={(e) => {
						const d = new Date(e.target.value);
						setInputValue(e.target.value);
						if (!isNaN(d.getTime())) {
							onChange(toIso(d));
							setMonth(d);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setOpen(true);
						}
					}}
					className="pr-9"
				/>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label="Select date"
							className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center size-7 rounded-md hover:bg-accent"
						>
							<CalendarIcon className="size-4" />
							<span className="sr-only">Select date</span>
						</button>
					</PopoverTrigger>
					<PopoverContent
						className="w-auto overflow-hidden p-0"
						align="end"
						alignOffset={-8}
						sideOffset={10}
					>
						<Calendar
							mode="single"
							selected={date}
							month={month}
							onMonthChange={setMonth}
							onSelect={(d) => {
								onChange(toIso(d));
								setInputValue(formatDisplay(d));
								setOpen(false);
							}}
						/>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
