import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { CreateInvoicePanel } from "#/features/invoices/components/create-invoice-panel";

export const Route = createLazyFileRoute("/invoices/new")({
	component: NewInvoice,
});

function NewInvoice() {
	const navigate = useNavigate();

	return (
		<div className="mx-auto max-w-6xl">
			<CreateInvoicePanel
				mode="page"
				onCreated={() => {
					navigate({ to: "/invoices" });
				}}
			/>
		</div>
	)
}
