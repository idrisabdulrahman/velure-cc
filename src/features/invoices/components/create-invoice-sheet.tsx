import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { CreateInvoicePanel } from "./create-invoice-panel";

type CreateInvoiceSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (invoiceId: string) => void;
};

export function CreateInvoiceSheet({
	open,
	onOpenChange,
	onCreated,
}: CreateInvoiceSheetProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				contentClassName="w-full sm:max-w-[920px] p-2"
				className="flex h-full min-h-0 flex-col border-[#1A1D22] bg-[#07090D] p-0 text-[#F2F3F5]"
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
					onCancel={() => onOpenChange(false)}
					onCreated={(invoiceId) => {
						onCreated?.(invoiceId);
						onOpenChange(false);
					}}
				/>
			</SheetContent>
		</Sheet>
	);
}
