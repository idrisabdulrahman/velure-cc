# Export formats

Every export leaves the Compliance page (Settings → Compliance → Exports) and
every artifact carries the NRS information disclaimer **inside the file
itself** — a downloaded copy can never read as a cleared tax filing
(e-invoicing SPEC A2). No Velure export is ever an NRS-validated or
NRS-cleared document.

**Status of this document:** descriptive contract for what ships today
(2026-11-01). Planned formats are listed at the end as *not built*.

**Language tags.** Each column carries one tag so nobody mistakes derived
number for authority:

| Tag | Meaning |
| --- | --- |
| `[stored]` | Read straight from the saved record or snapshot; Velure never re-computes it for export. |
| `[derived]` | Recomputed at export time from stored parts (e.g. fraction arithmetic on stored money). Always defined so the total still matches the stored invoice total. |
| `[computed]` | Produced by the export's own allocation rules (documented per column); exact identities are pinned by tests. |
| `[inferred]` | A value assumed when the stored record doesn't carry it (e.g. line rows for invoices saved without line items). Confidence is lower by definition. |

**Money units.** All monetary columns are **naira decimals** (major units,
2 dp). Internally the line-layer export computes in **kobo** integer
arithmetic and only divides by 100 at write time; no float arithmetic touches
the money path. Existing invoice-level CSVs emit the stored snapshot values
as-is (they are already major units).

**Sign convention.** Standard invoices, pro-formas, notes and refunds other
than credit notes are positive. A `credit_note` row(s) has **every money
column negated** (line and invoice level), because a credit note reduces
revenue. WHT is never negative from a source deduction; it appears as stored.

**Disclaimer.** The value of `NRS_INFORMATIONAL_DISCLAIMER`
(`src/features/compliance/nigeria.ts`). In CSV it is a quoted line above the
header row; in JSON it is a `disclaimer` field; in XLSX it sits in cell A1 of
the sheet, above the header row.

---

## Formats that exist today

| `kind` | File | Rows | Sheet/file layout |
| --- | --- | --- | --- |
| `invoices_csv` | `.csv` | one row per invoice | disclaimer line, header, data |
| `tax_summary_csv` | `.csv` | one row per invoice | same layout, same header print |
| `customer_ledger_csv` | `.csv` | one row per invoice | same layout, same header print |
| `normalized_accounting` | `.json` | all rows as JSON | `{generatedAt, disclaimer, invoices[]}` |
| `accountant_lines_csv` | `.csv` | one row per invoice **line** | disclaimer line, header, data |
| `accountant_lines_xlsx` | `.xlsx` | one row per invoice **line** | sheet `Invoice lines`; A1 = disclaimer; row 2 = header; data from row 3 |
| `vat_sales_schedule_csv` | `.csv` | one row per invoice | disclaimer line, header, data (see *VAT sales schedule* below) |

The three invoice-level CSV kinds share one writer; today they emit the same
columns (`invoiceNumber… dueDate`) plus the provisional accountant columns
added in `prompts/accountant-export-quality-2026-10.md`. `tax_summary_csv`
and `customer_ledger_csv` are labelled differently in the UI but keep the
same printable columns; both are **provisional** until the T10 follow-on
formats exist.

### Invoice-level CSV columns (`invoices_csv` / `tax_summary_csv` / `customer_ledger_csv`)

| Column | Tag | Notes |
| --- | --- | --- |
| `invoiceNumber` `[stored]` | | `invoices.invoice_number` |
| `customerName` `[stored]` | | `invoices.customer_name` |
| `documentType` `[stored]` | | `invoices.document_type`, defaults to `standard` |
| `currency` `[stored]` | | |
| `subtotal` `[stored]` | | `compliance.subtotal` (major units) |
| `vat` `[derived]` | | stored `compliance.totalTax` (VAT), not recomputed |
| `withholdingTax` `[stored]` | | `compliance.withholdingTaxAmount` |
| `total` `[derived]` | | precedence: `netPayable` → `grandTotal − withholdingTaxAmount` → Σ line items → `payment_amount` (only if nothing else). Mirrors `invoiceAmount` app-wide, because `payment_amount` is the amount PAID and would report 0 for unpaid invoices. |
| `status`, `issueDate`, `dueDate` `[stored]` | | |

### `normalized_accounting` (JSON)

Everything Velure holds about an invoice, one JSON object per invoice, plus
`generatedAt` and the disclaimer. `[stored]`; no projection is applied. Since
2026-11-01 the row objects may also contain `template_settings` (the invoice
craft settings, including the discount fields used by the line export).

---

## Accountant line export (T10 step 1, 2026-11-01)

Kinds `accountant_lines_csv` and `accountant_lines_xlsx`. Purpose: a
bookkeeping artifact with **one row per invoice line** so each line can be
posted to a ledger (QBO/Zoho/Xero style), while invoice totals stay
reconcilable. Same row model powers both formats; CSV is text, XLSX is a real
spreadsheet (numeric cells for money/quantity, text cells elsewhere).

### Group semantics

- Rows of one invoice travel together, in the invoice's stored order
  (`invoices.id` ascending).
- Repeating text keys (`invoiceNumber… customer… dates… status… docType…
  currency`) appear on **every** row.
- Invoice-level money columns (`invoiceSubtotal`, `invoiceDiscount`,
  `invoiceVat`, `invoiceWht`, `invoiceNetPayable`) appear **only on the first
  row of an invoice's group**; continuation rows leave them blank/empty.
- Therefore: to sum invoice totals in a spreadsheet, either filter a group's
  first row, or use per-line `lineNet + vat` which always sums back to the
  invoice total.

### Column reference

| # | Column | Tag | Notes |
| --- | --- | --- | --- |
| 1 | `invoiceNumber` | `[stored]` | repeated every row |
| 2 | `customerName` | `[stored]` | repeated |
| 3 | `documentType` | `[stored]` | repeated; defaults `standard` |
| 4 | `currency` | `[stored]` | repeated |
| 5 | `status` | `[stored]` | repeated |
| 6 | `issueDate` | `[stored]` | repeated |
| 7 | `dueDate` | `[stored]` | repeated |
| 8 | `lineDescription` | `[stored]` | line name; formula-lead values (`= + - @ TAB CR`) are neutralised with a leading apostrophe |
| 9 | `quantity` | `[stored]` | whole number |
| 10 | `unit` | `[stored]` | line unit, may be blank |
| 11 | `unitPrice` | `[stored]` | line price, major units |
| 12 | `lineGross` | `[computed]` | quantity × unitPrice in kobo, then a reconciliation residual rule (below) |
| 13 | `lineDiscount` | `[computed]` | allocation rules below; Σ = invoice discount |
| 14 | `vat` | `[computed]` | allocated share of the stored invoice VAT; Σ = `invoiceVat` |
| 15 | `lineNet` | `[computed]` | `lineGross − lineDiscount − (inclusive ? vat : 0)`; Σ(net+vat) = `grandTotal` |
| 16 | `vatCategory` | `[stored]` | `standard` / `zero_rated` / `exempt`; blank → `standard` |
| 17 | `classificationCode` | `[stored]` | B3-style product classification, may be blank |
| 18 | `invoiceSubtotal` | `[derived]` | stored `compliance.subtotal`; first row only |
| 19 | `invoiceDiscount` | `[derived]` | the invoice-level discount (from `template_settings` and, for line mode, Σ line discounts); first row only |
| 20 | `invoiceVat` | `[derived]` | stored `compliance.totalTax`; first row only |
| 21 | `invoiceWht` | `[derived]` | stored `compliance.withholdingTaxAmount`; **invoice-level only (Q-H)** — never allocated to a line; first row only |
| 22 | `invoiceNetPayable` | `[derived]` | same precedence as the invoice-level `total` column; first row only |

### Identities (pinned by focused tests)

In kobo, for every invoice and every mode (no discount, before-tax,
after-tax, line discount, exclusive, inclusive):

- Σ `lineGross` = `kobo(invoiceSubtotal)`
- Σ `lineDiscount` = `kobo(invoiceDiscount)`
- Σ `vat` = `kobo(invoiceVat)`
- Σ `lineNet` + Σ `vat` = `kobo(grandTotal)`

Because WHT is invoice-level only: `invoiceNetPayable = grandTotal −
invoiceWht` and the per-line `lineNet + vat` sums ignore it, exactly as the
app does (`invoiceAmount`, `netPayableFromCompliance`).

### Allocation rules (`[computed]` columns)

1. **Residual reconciliation (`lineGross`).** Stored line items are
   authoritative per line (quantity × unitPrice, kobo). If Σ stored lines
   ≠ `kobo(compliance.subtotal)` (possible for legacy rows saved before the
   money hardening), the **last line absorbs the residual** so the invoice
   still sums exactly to its stored subtotal. `invoiceSubtotal` (stored) is
   always the truth; a modified last `lineGross` is the visible consequence.
2. **Discount (`lineDiscount`).** Line-mode invoices take each line's own
   stored discount. Invoice-level discounts (`invoice_before_tax` and
   `invoice_after_tax`) are spread over the lines by **largest remainder**,
   weighted by line gross — in both modes — so Σ discount equals the full
   invoice discount either way. The modes are mutually exclusive per invoice
   (write-path guarantee), so no double counting is possible.
3. **VAT (`vat`).** The stored invoice VAT total (`compliance.totalTax`) is
   spread by largest remainder, weighted by (gross − discount) over
   `standard` lines only. `zero_rated`/`exempt` lines take 0. If the invoice
   stores a VAT total but has no standard-weighted line (legacy), the weight
   set falls back to all lines, and the last line takes any remainder.
4. **Net (`lineNet`).** `lineGross − lineDiscount` for exclusive treatment;
   `lineGross − lineDiscount − vat` when the invoice prices are
   VAT-inclusive. Inclusive/exclusive: trust the stored
   `compliance.taxTreatment`; when absent (legacy), infer inclusive iff
   `kobo(grandTotal) = kobo(subtotal) − discount`, else exclusive.
5. **Unsafe-integer guard.** Any kobo value that leaves `Number.isSafeInteger`
   range aborts the export rather than writing a corrupt number.

### Legacy and empty input (`[inferred]`)

- An invoice with no stored line items gets **one synthetic line row**,
  `lineDescription = "(no line items recorded)"`, `quantity = 0`, and its
  share of gross = the full invoice subtotal. Distinguishable by description
  and tagged here.
- Missing snapshot values degrade to `0` (as in the invoice-level CSVs);
  they never appear as `null`/`NaN`.

### XLSX storage note

`invoice_exports.content` is a text column. For `accountant_lines_xlsx` the
workbook bytes are stored **base64-encoded**; the download path decodes them
to a Blob with MIME
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. The
file name ends `.xlsx`; CSV/JSON kinds stay plain text.

---

## VAT sales schedule (T10 step 2, 2026-11-01)

Kind `vat_sales_schedule_csv`. Purpose: a VAT-only schedule for manual entry
against the FIRS **TaxPro Max** platform (or an accountant's VAT return): one
row per invoice, with the buyer TIN and the taxable/VAT split.

> **Provisional shape.** No official TaxPro Max sample has been supplied, so
> the **column order, the exact column names and the CSV-vs-XLSX choice are
> best-effort and may change** once a sample is available. This file is an
> informational export; it is **not** an NRS/TaxPro Max-validated or cleared
> filing (SPEC A2).

### Row semantics

- One row per invoice, in `invoices.id` order.
- The buyer TIN comes from the invoice's linked client (`clients.tax_id`); the
  seller TIN comes from the workspace (`workspaces.tax_id`).
- **Unknown TIN prints `0`.** A TIN is "unknown" when it is blank, fails the
  shared Nigerian TIN format check (10-12 digits), is an obvious placeholder
  /all-same-digit value, or the invoice has no linked client. The literal
  string `0` is written so a manual filing has a value to key on; it must
  never be read as a real, verified TIN.

### Column reference

| # | Column | Tag | Notes |
| --- | --- | --- | --- |
| 1 | `supplierTin` | `[derived]` | `workspaces.tax_id`; `0` when unknown |
| 2 | `customerTin` | `[derived]` | linked `clients.tax_id`; **`0` when unknown** |
| 3 | `customerName` | `[stored]` | `invoices.customer_name` |
| 4 | `invoiceNumber` | `[stored]` | |
| 5 | `invoiceDate` | `[stored]` | `issue_date` |
| 6 | `description` | `[inferred]` | first stored line name (formula-lead guarded); `(no line items recorded)` when none |
| 7 | `taxableAmount` | `[computed]` | VAT-exclusive taxable value (rule below) |
| 8 | `vatAmount` | `[derived]` | stored `compliance.totalTax`, never recomputed |
| 9 | `totalAmount` | `[computed]` | `taxableAmount + vatAmount` |
| 10 | `documentType` | `[stored]` | defaults `standard` |
| 11 | `currency` | `[stored]` | |

### Taxable computation (`taxableAmount`)

Recomputed with the same rule as `calculateInvoiceCompliance`, from the stored
snapshot (never re-deriving tax from a guessed rate):

- `taxableBase = subtotal − beforeTaxDiscount`, where `beforeTaxDiscount` is the
  invoice-level discount only for `invoice_before_tax` and the summed line
  discounts for line mode; an **`invoice_after_tax` discount does not reduce
  the taxable base** (tax was already computed on the pre-discount base).
- **Exclusive** (`exclusive_rate`): `taxableAmount = taxableBase`,
  `totalAmount = taxableBase + vatAmount`.
- **Inclusive** (`inclusive_rate`): the stored prices already contain VAT, so
  `taxableAmount = taxableBase − vatAmount`, `totalAmount = taxableBase`.
- **No VAT** (`none`/`exempt`/`zero_rated`): `vatAmount = 0`,
  `taxableAmount = totalAmount = taxableBase`.
- Legacy rows without a stored `taxTreatment` infer inclusive exactly like the
  accountant export (`grandTotal = subtotal − discount` and VAT > 0 → inclusive).

Therefore `taxableAmount + vatAmount = totalAmount` in every mode. For an
after-tax discount this `totalAmount` is the **pre-discount** VAT-able total
(the commercial discount is applied after tax), so it can exceed the invoice
`grandTotal`; that is intentional and documented.

### Sign convention

Credit notes negate `taxableAmount`, `vatAmount` and `totalAmount`, matching
the other exports. Text columns (TINs, name, number, description, dates, doc
type, currency) are never negated.

### Layout and storage

CSV only in this step: a leading `JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER)`
line, then the header row, then one data row per invoice. Free-text cells are
formula-lead guarded (`= + - @ TAB CR` → leading apostrophe). Stored as plain
UTF-8 text in `invoice_exports.content`; the file name ends `.csv`. An `.xlsx`
variant is **not built**.

---

## Not built yet (planned T10 order)

1. ~~**TaxPro Max-shaped VAT sales schedule**~~ — **built** as
   `vat_sales_schedule_csv` (provisional; see above).
2. **QBO/Zoho import CSVs, then Xero** — per-accounting-system import files
   respecting each system's row limits. Not built.
3. **Received-WHT credit tracker** — payment-time withholding credits
   receivable from clients. Proposal only; **not built** and not scheduled
   without product review (lightweight inventory/product boundary is the
   first constraint).
4. Steps 2–3 require official TaxPro Max / QBO / Zoho / Xero samples to
   confirm column order and row limits; the format doc will gain a new
   section per delivered file. Every new sheet format will restate the
   disclaimer rule above.

## Known limitations

- The three invoice-level CSVs share one writer, so they cannot have
  different column sets yet; renaming their columns changes all three.
- XLSX has no styling (colors, formulas, merged cells) deliberately: the file
  must feed accountants' scripts and imports, not presentations.
- Like everything in Velure, exports are informational. They are not NRS
  filings and must not be presented as such.
