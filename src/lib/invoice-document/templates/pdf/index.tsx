import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import QRCodeUtil from "qrcode";
import type { Invoice } from "../../types";
import { EditorContent } from "./components/editor-content";
import { LineItems } from "./components/line-items";
import { Meta } from "./components/meta";
import { Note } from "./components/note";
import { PaymentDetails } from "./components/payment-details";
import { QRCode } from "./components/qr-code";
import { Summary } from "./components/summary";

export async function PdfTemplate({
	invoiceNumber,
	customerPoNumber,
	issueDate,
	dueDate,
	template,
	lineItems,
	customerDetails,
	fromDetails,
	discount,
	paymentDetails,
	noteDetails,
	currency,
	vat,
	tax,
	withholdingTax,
	netPayable,
	amount,
	topBlock,
	bottomBlock,
	token,
	mockClearance,
}: Invoice) {
	let qrCode = null;
	let clearanceQrCode = null;

	if (template.includeQr) {
		const origin =
			process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? "https://velure.app";
		qrCode = await QRCodeUtil.toDataURL(
			`${origin.replace(/\/$/, "")}/i/${token}`,
			{
				margin: 0,
				width: 40 * 3,
			},
		);
	}
	if (mockClearance) {
		clearanceQrCode = await QRCodeUtil.toDataURL(mockClearance.qrPayload, {
			margin: 0,
			width: 40 * 3,
		});
	}

	return (
		<Document>
			<Page
				wrap
				size={template.size.toUpperCase() as "LETTER" | "A4"}
				style={{
					padding: 20,
					backgroundColor: "#fff",
					color: "#000",
					fontFamily: "Helvetica",
					fontWeight: 400,
				}}
			>
				<View
					style={{
						marginBottom: 20,
						flexDirection: "row",
						justifyContent: "space-between",
					}}
				>
					<Meta
						invoiceNoLabel={template.invoiceNoLabel}
						customerPoNumber={customerPoNumber}
						issueDateLabel={template.issueDateLabel}
						dueDateLabel={template.dueDateLabel}
						invoiceNo={invoiceNumber}
						issueDate={issueDate}
						dueDate={dueDate}
						timezone={template.timezone}
						dateFormat={template.dateFormat}
						title={template.title}
					/>

					{template?.logoUrl && (
						<View style={{ maxWidth: 300 }}>
							<Image
								src={template.logoUrl}
								style={{
									height: 75,
									objectFit: "contain",
								}}
							/>
						</View>
					)}
				</View>

				<View style={{ flexDirection: "row", marginTop: 20 }}>
					<View style={{ flex: 1, marginRight: 10 }}>
						<View style={{ marginBottom: 20 }}>
							<Text style={{ fontSize: 9, fontWeight: 500 }}>
								{template.fromLabel}
							</Text>
							<EditorContent content={fromDetails} />
						</View>
					</View>

					<View style={{ flex: 1, marginLeft: 10 }}>
						<View style={{ marginBottom: 20 }}>
							<Text style={{ fontSize: 9, fontWeight: 500 }}>
								{template.customerLabel}
							</Text>
							<EditorContent content={customerDetails} />
						</View>
					</View>
				</View>

				<EditorContent content={topBlock} />

				<LineItems
					lineItems={lineItems}
					currency={currency}
					descriptionLabel={template.descriptionLabel}
					quantityLabel={template.quantityLabel}
					priceLabel={template.priceLabel}
					totalLabel={template.totalLabel}
					locale={template.locale}
					includeDecimals={template.includeDecimals}
					includeUnits={template.includeUnits}
				/>

				<View
					style={{
						flexDirection: "column",
					}}
				>
					<Summary
						amount={amount}
						tax={tax}
						vat={vat}
						currency={currency}
						totalLabel={template.totalSummaryLabel}
						taxLabel={template.taxLabel}
						vatLabel={template.vatLabel}
						taxRate={template.taxRate}
						vatRate={template.vatRate}
						locale={template.locale}
						discount={discount}
						discountLabel={template.discountLabel}
						withholdingTaxAmount={withholdingTax}
						withholdingTaxLabel={template.withholdingTaxLabel}
						withholdingTaxRate={template.withholdingTaxRate}
						netPayable={netPayable}
						netAmountLabel={template.netAmountLabel}
						includeDiscount={template.includeDiscount}
						includeVat={template.includeVat}
						includeTax={template.includeTax}
						includeDecimals={template.includeDecimals}
						subtotalLabel={template.subtotalLabel}
						lineItems={lineItems}
					/>

					<View style={{ flexDirection: "row", marginTop: 20 }}>
						<View style={{ flex: 1, marginRight: 10 }}>
							<PaymentDetails
								content={paymentDetails}
								paymentLabel={template.paymentLabel}
							/>

							{qrCode && <QRCode data={qrCode} />}
							{mockClearance && clearanceQrCode ? (
								<View style={{ marginTop: 16 }}>
									<Text style={{ fontSize: 8, fontWeight: 700 }}>
										MOCK SANDBOX — NOT NRS CLEARED
									</Text>
									<Text style={{ fontSize: 8, marginTop: 4 }}>
										Mock IRN: {mockClearance.irn}
									</Text>
									<QRCode data={clearanceQrCode} />
								</View>
							) : null}
						</View>

						<View style={{ flex: 1, marginLeft: 10 }}>
							<Note content={noteDetails} noteLabel={template.noteLabel} />
						</View>
					</View>

					<EditorContent content={bottomBlock} />
				</View>
			</Page>
		</Document>
	);
}
