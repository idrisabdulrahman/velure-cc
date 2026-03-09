import type React from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import type { Invoice } from "../../types";
import { EditorContent } from "./components/editor-content";
import { LineItems } from "./components/line-items";
import { Logo } from "./components/logo";
import { Meta } from "./components/meta";
import { Summary } from "./components/summary";

type Props = {
	data: Invoice;
	width: number;
	height: number;
	appearance?: "print" | "app";
};

export function HtmlTemplate({
	data,
	width,
	height,
	appearance = "print",
}: Props) {
	if (!data) {
		return null;
	}

	const {
		invoiceNumber,
		issueDate,
		dueDate,
		template,
		lineItems,
		customerDetails,
		fromDetails,
		paymentDetails,
		noteDetails,
		currency,
		discount,
		customerName,
		topBlock,
		bottomBlock,
	} = data;

	const isAppAppearance = appearance === "app";
	const paperVars = isAppAppearance
		? ({
				["--invoice-bg" as string]: "#090D14",
				["--invoice-border" as string]: "#1A1D22",
				["--invoice-text" as string]: "#F2F3F5",
				["--invoice-muted" as string]: "#8A8F99",
				["--invoice-rule" as string]: "#232A34",
			} satisfies React.CSSProperties)
		: ({
				["--invoice-bg" as string]: "#FFFFFF",
				["--invoice-border" as string]: "#D7DCE6",
				["--invoice-text" as string]: "#111319",
				["--invoice-muted" as string]: "#878787",
				["--invoice-rule" as string]: "#D7DCE6",
			} satisfies React.CSSProperties);

	const content = (
		<div
			className="flex h-full flex-col p-4 sm:p-6 md:p-8"
			style={{ minHeight: height - 5 }}
		>
			<div className="flex justify-between">
				<Meta
					template={template}
					invoiceNumber={invoiceNumber}
					issueDate={issueDate}
					dueDate={dueDate}
				/>

				{template.logoUrl && (
					<Logo logo={template.logoUrl} customerName={customerName || ""} />
				)}
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mt-6 mb-4">
				<div>
					<p className="mb-2 block text-[11px] text-[var(--invoice-muted)]">
						{template.fromLabel}
					</p>
					<EditorContent content={fromDetails} />
				</div>
				<div className="mt-4 md:mt-0">
					<p className="mb-2 block text-[11px] text-[var(--invoice-muted)]">
						{template.customerLabel}
					</p>
					<EditorContent content={customerDetails} />
				</div>
			</div>

			<EditorContent content={topBlock} />

			<LineItems
				lineItems={lineItems}
				currency={currency}
				descriptionLabel={template.descriptionLabel}
				quantityLabel={template.quantityLabel}
				priceLabel={template.priceLabel}
				totalLabel={template.totalLabel}
				includeDecimals={template.includeDecimals}
				locale={template.locale}
				includeUnits={template.includeUnits}
			/>

			<div className="mt-10 md:mt-12 flex justify-end mb-6 md:mb-8">
				<Summary
					includeVat={template.includeVat}
					includeTax={template.includeTax}
					taxRate={template.taxRate}
					vatRate={template.vatRate}
					currency={currency}
					vatLabel={template.vatLabel}
					taxLabel={template.taxLabel}
					totalLabel={template.totalSummaryLabel}
					lineItems={lineItems}
					includeDiscount={template.includeDiscount}
					discountLabel={template.discountLabel}
					discount={discount}
					locale={template.locale}
					includeDecimals={template.includeDecimals}
					subtotalLabel={template.subtotalLabel}
				/>
			</div>

			<div className="mt-auto flex flex-col space-y-6 md:space-y-8">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
					<div>
						<p className="mb-2 block text-[11px] text-[var(--invoice-muted)]">
							{template.paymentLabel}
						</p>
						<EditorContent content={paymentDetails} />
					</div>
					{noteDetails && (
						<div className="mt-4 md:mt-0">
							<p className="mb-2 block text-[11px] text-[var(--invoice-muted)]">
								{template.noteLabel}
							</p>
							<EditorContent content={noteDetails} />
						</div>
					)}
				</div>

				<EditorContent content={bottomBlock} />
			</div>
		</div>
	);

	if (isAppAppearance) {
		return (
			<div
				className="border bg-[var(--invoice-bg)] text-[var(--invoice-text)] shadow-[0_32px_90px_-48px_rgba(0,0,0,0.9)] [&_*]:text-inherit"
				style={{
					width,
					minWidth: width,
					height,
					borderColor: "var(--invoice-border)",
					...paperVars,
				}}
			>
				{content}
			</div>
		);
	}

	return (
		<ScrollArea
			className="h-full w-full border bg-[var(--invoice-bg)] text-[var(--invoice-text)] [&_*]:text-inherit [&>div]:h-full"
			style={{
				width: "100%",
				maxWidth: width,
				height,
				borderColor: "var(--invoice-border)",
				...paperVars,
			}}
			hideScrollbar
		>
			{content}
		</ScrollArea>
	);
}
