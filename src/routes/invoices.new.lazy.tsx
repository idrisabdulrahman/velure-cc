import { createLazyFileRoute } from "@tanstack/react-router";
import { CreateInvoicePanel } from "#/features/invoices/components/create-invoice-panel";

export const Route = createLazyFileRoute("/invoices/new")({
	component: NewInvoice,
});

function NewInvoice() {
	return (
		<div className="mx-auto max-w-295 px-4 pb-8 pt-2 sm:px-6">
			{/* The composer renders its own headings below the fold; this gives the
			 * page the single level-1 heading the shell's route contract expects. */}
			<h1 className="sr-only">New invoice</h1>
			<CreateInvoicePanel mode="page" />
		</div>
	);
}
