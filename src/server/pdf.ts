import { renderToBuffer } from "@react-pdf/renderer";
import { toMiddayInvoice } from "#/features/invoices/midday-adapter";
import { PdfTemplate } from "#/lib/midday-invoice/templates/pdf";
import type { Invoice } from "./invoice-repository";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function renderFallbackPdf(invoice: Invoice): Uint8Array {
  const rows = [
    `Invoice ${invoice.invoiceNumber}`,
    `Customer: ${invoice.customerName || "Untitled customer"}`,
    `Status: ${invoice.status}`,
    `Issue Date: ${invoice.issueDate}`,
    `Due Date: ${invoice.dueDate}`,
    "",
    "Line Items:",
  ];

  for (const item of invoice.lineItems) {
    const total = item.quantity * item.price;
    rows.push(
      `- ${item.name || "Untitled item"} | qty ${item.quantity} | price ${item.price.toFixed(2)} | total ${total.toFixed(2)}`,
    );
  }

  const subtotal =
    invoice.compliance?.subtotal ??
    invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const vat = invoice.compliance?.totalTax ?? 0;
  const wht = invoice.compliance?.withholdingTaxAmount ?? 0;
  const grandTotal = invoice.compliance?.grandTotal ?? subtotal + vat;
  const netPayable = grandTotal - wht;

  rows.push("");
  rows.push(`Subtotal: ${subtotal.toFixed(2)} ${invoice.currency}`);
  if (vat > 0) rows.push(`VAT: ${vat.toFixed(2)} ${invoice.currency}`);
  if (wht > 0) rows.push(`WHT deduction: ${wht.toFixed(2)} ${invoice.currency}`);
  rows.push(`Total: ${grandTotal.toFixed(2)} ${invoice.currency}`);
  rows.push(`Net payable: ${netPayable.toFixed(2)} ${invoice.currency}`);
  if (invoice.paymentLink) rows.push(`Payment link: ${invoice.paymentLink}`);
  if (invoice.notes) rows.push(`Notes: ${invoice.notes}`);

  const textOps = rows
    .map((line, index) => {
      const y = 800 - index * 18;
      return `BT /F1 12 Tf 50 ${y} Td (${escapePdfText(line)}) Tj ET`;
    })
    .join("\n");

  const stream = `${textOps}\n`;
  const streamBytes = Buffer.from(stream, "utf8");

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
  );
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  objects.push(`5 0 obj << /Length ${streamBytes.length} >> stream\n${stream}endstream endobj`);

  let body = "";
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${object}\n`;
  }

  const xrefStart = Buffer.byteLength(`%PDF-1.4\n${body}`, "utf8");
  const xrefRows = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (let i = 1; i <= objects.length; i++) {
    const absolute = offsets[i] + Buffer.byteLength("%PDF-1.4\n", "utf8");
    xrefRows.push(`${String(absolute).padStart(10, "0")} 00000 n `);
  }

  const trailer = [
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefStart),
    "%%EOF",
  ].join("\n");

  const pdf = `%PDF-1.4\n${body}${xrefRows.join("\n")}\n${trailer}\n`;
  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

export async function renderInvoicePdf(invoice: Invoice): Promise<Uint8Array> {
  try {
    const document = await PdfTemplate(toMiddayInvoice(invoice));

    const buffer = await renderToBuffer(document);
    return new Uint8Array(buffer);
  } catch (error) {
    console.error("Failed to render invoice PDF template, using fallback PDF.", error);
    return renderFallbackPdf(invoice);
  }
}
