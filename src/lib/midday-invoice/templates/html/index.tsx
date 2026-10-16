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
	appearance?: "print" | "app" | "public";
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
		customerPoNumber,
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
		withholdingTax,
		netPayable,
		customerName,
		topBlock,
		bottomBlock,
	} = data;

	const isAppAppearance = appearance === "app";
	const isPublicAppearance = appearance === "public";
	const paperVars = isPublicAppearance
		? ({
				["--invoice-bg" as string]: "#101011",
				["--invoice-border" as string]: "#242426",
				["--invoice-text" as string]: "#F2EDE6",
				["--invoice-muted" as string]: "#85817B",
				["--invoice-rule" as string]: "#232325",
				["--invoice-editor-size" as string]: "12px",
			} satisfies React.CSSProperties)
		: isAppAppearance
			? ({
					["--invoice-bg" as string]: "#090D14",
					["--invoice-border" as string]: "#30352f",
					["--invoice-text" as string]: "#f2efe7",
					["--invoice-muted" as string]: "#817d72",
					["--invoice-rule" as string]: "#232A34",
					["--invoice-editor-size" as string]: "11px",
				} satisfies React.CSSProperties)
			: ({
					["--invoice-bg" as string]: "#FFFFFF",
					["--invoice-border" as string]: "#D7DCE6",
					["--invoice-text" as string]: "#111319",
					["--invoice-muted" as string]: "#817d72",
					["--invoice-rule" as string]: "#D7DCE6",
					["--invoice-editor-size" as string]: "11px",
				} satisfies React.CSSProperties);
	const sectionLabelClass = isPublicAppearance
		? "mb-3 block text-[12px] text-[var(--invoice-muted)]"
		: "mb-2 block text-[11px] text-[var(--invoice-muted)]";
	const contentClassName = isPublicAppearance
		? "flex h-full flex-col px-8 pb-8 pt-7"
		: "flex h-full flex-col p-4 sm:p-6 md:p-8";

	const content = (
		<div className={contentClassName} style={{ minHeight: height - 5 }}>
			<div className="flex justify-between">
				<Meta
					template={template}
					invoiceNumber={invoiceNumber}
					customerPoNumber={customerPoNumber}
					issueDate={issueDate}
					dueDate={dueDate}
					appearance={appearance}
				/>

				{template.logoUrl && (
					<Logo
						logo={template.logoUrl}
						customerName={customerName || ""}
						appearance={appearance}
					/>
				)}
			</div>

			<div
				className={`grid grid-cols-2 ${isPublicAppearance ? "mb-5 mt-8 gap-12" : "mb-4 mt-6 gap-4 md:gap-6"}`}
			>
				<div>
					<p className={sectionLabelClass}>{template.fromLabel}</p>
					<EditorContent content={fromDetails} />
				</div>
				<div>
					<p className={sectionLabelClass}>{template.customerLabel}</p>
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
				appearance={appearance}
			/>

			<div
				className={`mb-6 flex justify-end ${isPublicAppearance ? "mt-12" : "mt-10 md:mb-8 md:mt-12"}`}
			>
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
					withholdingTaxAmount={withholdingTax}
					withholdingTaxLabel={template.withholdingTaxLabel}
					withholdingTaxRate={template.withholdingTaxRate}
					netPayable={netPayable}
					netAmountLabel={template.netAmountLabel}
					locale={template.locale}
					includeDecimals={template.includeDecimals}
					subtotalLabel={template.subtotalLabel}
					appearance={appearance}
				/>
			</div>

			<div
				className={`mt-auto flex flex-col ${isPublicAppearance ? "space-y-6" : "space-y-6 md:space-y-8"}`}
			>
				<div
					className={`grid grid-cols-2 ${isPublicAppearance ? "gap-12" : "gap-4 md:gap-6"}`}
				>
					<div>
						<p className={sectionLabelClass}>{template.paymentLabel}</p>
						<EditorContent content={paymentDetails} />
					</div>
					{noteDetails && (
						<div>
							<p className={sectionLabelClass}>{template.noteLabel}</p>
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

	if (isPublicAppearance) {
		return (
			<div
				className="max-h-[100dvh] overflow-y-auto border bg-[var(--invoice-bg)] text-[var(--invoice-text)] shadow-[0_38px_120px_-64px_rgba(0,0,0,0.95)] [scrollbar-width:none] [&_*]:text-inherit"
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
