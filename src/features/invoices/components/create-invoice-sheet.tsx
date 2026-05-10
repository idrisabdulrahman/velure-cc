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

export function CreateInvoiceSheet({ open, onOpenChange, onCreated }: CreateInvoiceSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        contentClassName="w-full p-0 md:p-0 sm:max-w-[940px]"
        className="flex h-full min-h-0 flex-col border-[#2b2d30] bg-[#121314] p-0 text-[#ece7de]"
        title="Create invoice"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Create invoice</SheetTitle>
          <SheetDescription>Create a new invoice without leaving the dashboard.</SheetDescription>
        </SheetHeader>
        <CreateInvoicePanel mode="sheet" onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  );
}
