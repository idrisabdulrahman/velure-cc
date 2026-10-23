import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import type { ImportedInvoiceDraft } from "#/features/invoices/import-spreadsheet";
import type { InvoiceDocumentType } from "#/features/invoices/types";
import { CreateInvoicePanel } from "./create-invoice-panel";

type CreateInvoiceSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (invoiceId: string) => void;
	initialDraft?: ImportedInvoiceDraft | null;
	initialDocumentType?: InvoiceDocumentType;
};

export function CreateInvoiceSheet({
	open,
	onOpenChange,
	onCreated,
	initialDraft,
	initialDocumentType = "standard",
}: CreateInvoiceSheetProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				contentClassName="w-full p-0 md:p-0 sm:max-w-[600px]"
				className="flex h-full min-h-0 flex-col border-rule bg-paper p-0 text-ink"
				title="Create invoice"
			>
				<SheetHeader className="sr-only">
					<SheetTitle>Create invoice</SheetTitle>
					<SheetDescription>
						Create a new invoice without leaving the dashboard.
					</SheetDescription>
				</SheetHeader>
				<CreateInvoicePanel
					mode="sheet"
					onCreated={onCreated}
					initialDraft={initialDraft}
					initialDocumentType={initialDocumentType}
				/>
			</SheetContent>
		</Sheet>
	);
}
