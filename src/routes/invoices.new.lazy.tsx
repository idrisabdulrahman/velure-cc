import { createLazyFileRoute } from "@tanstack/react-router";
import { CreateInvoicePanel } from "#/features/invoices/components/create-invoice-panel";

export const Route = createLazyFileRoute("/invoices/new")({
	component: NewInvoice,
});

function NewInvoice() {
	return (
		<div className="mx-auto max-w-[1180px] px-4 pb-8 pt-2 sm:px-6">
			<CreateInvoicePanel mode="page" />
		</div>
	);
}
