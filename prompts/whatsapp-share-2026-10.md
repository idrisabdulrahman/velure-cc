# T8 — WhatsApp share everywhere an invoice is shared

Status: done
Task: T8 from `Task List.md`.

## Goal

Make the WhatsApp click-to-chat share (public invoice URL + prefilled message,
no API and no WhatsApp Business account) available at every place a seller
shares an invoice, and remove the duplicate link-building code so the surfaces
cannot drift.

## Premise check (the critique is refuted)

`Task List.md` T8 asks "why is delivery limited to email plus a copyable public
link? Was WhatsApp considered, rejected, or just not reached?" A full
WhatsApp + Telegram + native-share implementation **already exists** in
`src/features/invoices/components/invoice-details-sheet.tsx:135-148` and
`:1956-2035` (added in `9ca64b0`). No decision to reject it is recorded in git,
`docs/DECISIONS.md`, the prompts, or the Obsidian handoff — it was simply built
before the critique.

The only surfaces missing it are the post-create "invoice ready" card and the
public payer page.

## Decisions / assumptions (confirmed with user)

- **2026-10-30 (user):** "1 & 2" — extend the post-create card **and** add the
  share action to the public invoice page.
- No API, no WhatsApp Business account. Keep the `wa.me/?text=` click-to-chat
  format already in use.
- Preserve existing UI/behaviour (Q-C): the details-sheet hrefs must come out
  byte-identical after the refactor.
- Reuse before adding abstraction (AGENTS.md §9): one pure helper shared by all
  three callers.

## Skills read

- `react-ui-patterns` and `frontend-design` (installed) for accessible,
  token-consistent icon actions. Repo governance applied by hand: keyboard
  access, `aria-label`s, and the locked Wayfare tokens in `design.md` /
  `src/styles.css` must be preserved.

## Existing code inspected

- `src/features/invoices/components/invoice-details-sheet.tsx:31` — imports
  `FaTelegram`, `FaWhatsapp` from `react-icons/fa6`.
- `src/features/invoices/components/invoice-details-sheet.tsx:135-148` —
  private `shareLinks(invoice)` building `publicUrl`, `downloadUrl`, `text`,
  `body`, `telegramHref`, `whatsappHref`.
- `src/features/invoices/components/invoice-details-sheet.tsx:1922-2035` — the
  Share section (email + Telegram/WhatsApp/native/copy/preview buttons).
- `src/features/invoices/components/create-invoice-panel.tsx:170-179` —
  `CreatedInvoiceSummary` (`token`, `documentType`, `invoiceNumber`,
  `customerName`, ...).
- `src/features/invoices/components/create-invoice-panel.tsx:1079-1081` —
  `createdInvoicePublicUrl`; `:1710-1727` — `copyInvoiceLink`;
  `:2003-2116` — success card; `:2076-2101` — copy/preview row;
  `:17-35` — lucide imports.
- `src/routes/i.$token.tsx:40-90` — `invoice` is an `InvoiceRecord`;
  `:139-157` — `copyPublicLink`; `:390-414` — floating action bar.
- `src/features/invoices/types.ts:62-75` — `InvoiceDocumentType`,
  `INVOICE_DOCUMENT_TYPE_LABELS`.

## Files likely to change or be added

- **Add** `src/features/invoices/share-links.ts` — pure
  `buildInvoiceShareLinks({ token, origin, invoiceNumber, customerName,
  documentType })` returning `{ publicUrl, downloadUrl, text, body,
  telegramHref, whatsappHref }`. It must reproduce the current output exactly.
- **Add** `src/features/invoices/share-links.test.ts` — pin the hrefs,
  encoding, `?download=1` body link, and document-type label.
- **Edit** `src/features/invoices/components/invoice-details-sheet.tsx` — call
  the shared helper; delete the private copy.
- **Edit** `src/features/invoices/components/create-invoice-panel.tsx` — add
  WhatsApp + Telegram + native-share actions to the success card.
- **Edit** `src/routes/i.$token.tsx` — add a WhatsApp share action to the
  floating bar.
- **Add** `prompts/whatsapp-share-2026-10.md` (this file).

## Implementation requirements

1. `buildInvoiceShareLinks` is pure and framework-free. Callers pass
   `window.location.origin`.
2. Details-sheet output must be unchanged:
   - `whatsappHref = https://wa.me/?text=<encoded body>`
   - `telegramHref = https://t.me/share/url?url=<encoded publicUrl>&text=<encoded body>`
   - `body = "<label> <number> for <customer>\n\nView & download: <publicUrl>?download=1"`
3. Post-create card: add WhatsApp and Telegram anchors (`target="_blank"`,
   `rel="noreferrer"`) and a native-share button that falls back to copying the
   public URL, matching the details-sheet behaviour. Keep the existing copy and
   preview actions.
4. Public page: add a WhatsApp share anchor to the existing floating action bar,
   styled with the same classes as the download/copy buttons. It must be
   keyboard-focusable with a clear `aria-label`/`title`.
5. Responsive: the new controls must stay inside the card/bar at 320, 375, 414
   and 768 px and must not introduce layout shift.
6. Do not add a dependency — `react-icons/fa6` is already installed.
7. No server, schema, auth, money, numbering, or issued-invoice change.

## Acceptance criteria

1. The shared helper produces the exact hrefs the details sheet produced before.
2. The details sheet still renders Telegram/WhatsApp/native/copy/preview as-is.
3. The post-create card offers WhatsApp and Telegram share with the correct
   public URL and prefilled message.
4. The public invoice page offers a WhatsApp share of its own URL.
5. New unit tests cover the helper (standard vs credit-note label, encoding,
   download link) and pass.
6. `pnpm typecheck`, focused tests, `pnpm test`, and `pnpm check` pass.

## Checks to run

- `pnpm typecheck`
- `pnpm vitest run src/features/invoices/share-links.test.ts`
- `pnpm test`
- `pnpm check`
- Manual/responsive: at 320/375/414/768 px the new icon buttons stay inside the
  card/bar, remain focusable, and expose an accessible name.

## Scope changes (append-only)

- 2026-10-30: Prompt created. Premise refuted; user chose card + public page.

## Result

Status: done (2026-10-30).

### Files changed

- **Added** `src/features/invoices/share-links.ts` — pure, framework-free
  `buildInvoiceShareLinks({ token, origin, invoiceNumber, customerName,
  documentType })` returning `{ publicUrl, downloadUrl, text, body,
  telegramHref, whatsappHref }`. This is the single source of truth for the
  link format/encoding.
- **Added** `src/features/invoices/share-links.test.ts` — 5 tests pinning the
  public/download URLs, the `?download=1` body link, standard vs credit-note
  labels, and WhatsApp/Telegram percent-encoding.
- **Edited** `src/features/invoices/components/invoice-details-sheet.tsx` —
  deleted the private URL/encoding body and replaced it with a one-line
  `invoiceShareLinks(invoice)` adapter over the shared helper; updated the 5
  call sites. Hrefs are unchanged.
- **Edited** `src/features/invoices/components/create-invoice-panel.tsx` —
  success card now derives `shareLinks` from the helper and offers Telegram and
  WhatsApp anchors (`target="_blank"`, `rel="noreferrer"`, `aria-label`/`title`)
  plus a native-share button that falls back to copying the public URL. Kept the
  existing copy and preview actions; made the row `flex-wrap` + `min-w-0` so the
  controls stay inside the card at 320/375/414/768 px.
- **Edited** `src/routes/i.$token.tsx` — added a WhatsApp share anchor to the
  public page floating bar, using the same classes as the download/copy buttons,
  with `aria-label`/`title`.

No server, schema, auth, money, numbering, or issued-invoice changes. No new
dependency (`react-icons/fa6` was already installed).

### Exact check results

- `pnpm typecheck` — passed (no output, exit 0).
- `pnpm vitest run src/features/invoices/share-links.test.ts` — 1 file passed,
  5 tests passed.
- `pnpm test` — 100 files passed, 13 skipped; 819 tests passed, 116 skipped.
- `pnpm check` — exit 0; 359 pre-existing warnings, 0 errors after fixing two
  formatting diffs the new files introduced (`biome check --write`).
- `pnpm exec biome check` on the five changed files — 0 errors, 1 pre-existing
  warning (`noNonNullAssertion` in `invoice-details-sheet.tsx:451`, untouched).

### Acceptance evidence

1. Helper output is byte-identical to the deleted details-sheet logic: same
   `${origin}/i/${token}`, `${publicUrl}?download=1`,
   `${label} ${number} for ${customer}`,
   `\n\nView & download: <downloadUrl>`, and the same `t.me`/`wa.me` templates.
2. Details sheet still renders Telegram/WhatsApp/native/copy/preview; only the
   private function body changed to delegate to the shared helper.
3. Post-create card renders WhatsApp + Telegram anchors with the correct public
   URL and prefilled message, plus native share with copy fallback.
4. Public invoice page floating bar renders a WhatsApp share of its own URL.
5. New unit tests cover the helper and pass.
6. All four commands above pass.

### Notes / deviations

- The helper returns `downloadUrl`, `text`, and `body` in addition to the three
  fields the details sheet previously returned (per the task spec).
- The details sheet keeps a named one-line `invoiceShareLinks(invoice)` adapter
  (field mapping only) instead of inlining the five-field argument at five call
  sites, to avoid re-introducing drift. No URL/encoding logic remains there.
- The worktree is missing the gitignored `design/` kit assets, which made
  `src/components/brand/velure-symbol.test.tsx` fail with ENOENT before any
  change. A gitignored local copy of `design/` was placed in the worktree purely
  to run the suite; it is not committed and is unrelated to this task.
- Manual responsive check at 320/375/414/768 px was not run in a browser in this
  environment; the card row was hardened with `flex-wrap`/`min-w-0` and all new
  controls are keyboard-focusable anchors/buttons with accessible names.
