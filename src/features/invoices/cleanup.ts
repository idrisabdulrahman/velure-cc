export function duplicateInvoiceNumberSet(
	invoices: Array<{ invoiceNumber: string }>,
) {
	const counts = new Map<string, number>();
	for (const invoice of invoices) {
		counts.set(
			invoice.invoiceNumber,
			(counts.get(invoice.invoiceNumber) ?? 0) + 1,
		);
	}

	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.map(([invoiceNumber]) => invoiceNumber),
	);
}

export function duplicateInvoiceRowCount(
	invoices: Array<{ invoiceNumber: string }>,
) {
	const duplicateNumbers = duplicateInvoiceNumberSet(invoices);
	return invoices.filter((invoice) =>
		duplicateNumbers.has(invoice.invoiceNumber),
	).length;
}
