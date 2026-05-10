import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { Template } from "../../../types";

type Props = {
  template: Template;
  invoiceNumber: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  appearance?: "print" | "app" | "public";
};

export function Meta({ template, invoiceNumber, issueDate, dueDate, appearance = "print" }: Props) {
  if (!template) {
    return null;
  }

  const isPublicAppearance = appearance === "public";
  const titleClassName = isPublicAppearance
    ? "mb-2 w-fit min-w-[100px] font-serif text-[32px] font-normal tracking-[-0.03em]"
    : "mb-1 w-fit min-w-[100px] text-[21px] font-medium";
  const metaRowClassName = isPublicAppearance
    ? "text-[13px] text-[var(--invoice-text)]"
    : "text-[11px] flex-shrink-0";
  const labelClassName = isPublicAppearance
    ? "truncate text-[12px] text-[var(--invoice-muted)]"
    : "truncate text-[11px] text-[var(--invoice-muted)]";

  return (
    <div className="mb-2">
      <h2 className={titleClassName}>{template.title}</h2>
      <div className={`flex flex-col ${isPublicAppearance ? "gap-1.5" : "gap-0.5"}`}>
        <div className="flex space-x-1 items-center">
          <div className="flex items-center flex-shrink-0 space-x-1">
            <span className={labelClassName}>
              {template.invoiceNoLabel ? `${template.invoiceNoLabel}:` : ""}
            </span>
            <span className={metaRowClassName}>{invoiceNumber}</span>
          </div>
        </div>

        <div>
          <div>
            <div className="flex space-x-1 items-center">
              <div className="flex items-center flex-shrink-0 space-x-1">
                <span className={labelClassName}>
                  {template.issueDateLabel ? `${template.issueDateLabel}:` : ""}
                </span>
                <span className={metaRowClassName}>
                  {issueDate
                    ? format(new TZDate(issueDate, template.timezone), template.dateFormat)
                    : ""}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div>
            <div className="flex space-x-1 items-center">
              <div className="flex items-center flex-shrink-0 space-x-1">
                <span className={labelClassName}>
                  {template.dueDateLabel ? `${template.dueDateLabel}:` : ""}
                </span>
                <span className={metaRowClassName}>
                  {dueDate
                    ? format(new TZDate(dueDate, template.timezone), template.dateFormat)
                    : ""}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
