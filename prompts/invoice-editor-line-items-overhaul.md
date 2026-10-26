# Invoice editor line items overhaul

Status: done

## Goal

Correct invoice editor line-item visibility, live money totals, catalog search, required tax details, alignment, client selection, date feedback, and footer status. Capture the requested three-item walkthrough.

## Decisions / assumptions (confirmed with user)

- The user's numbered P0/P1/P2 behaviors and screen-capture acceptance are the scope.
- Preserve the existing Supabase workspace-scoped private editor and invoice persistence shape. Use the existing `invoice_template_defaults` workspace JSON for a business default VAT category, exposed in Settings; no schema migration is needed.
- Midday parity: `adapt` the live line-item editing and catalog selection from `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/invoice/line-items.tsx` and `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/invoice/product-autocomplete.tsx` into the existing Velure composer; keep Nigeria-specific VAT/classification fields. No public route behavior changes.

## Skills read

- `/home/asys/.agents/skills/debug/SKILL.md`
- `/home/asys/.agents/skills/frontend-developer/SKILL.md`
- `/home/asys/.agents/skills/react-ui-patterns/SKILL.md`
- `/home/asys/.agents/skills/accessibility/SKILL.md`
- `/home/asys/.agents/skills/frontend-design/SKILL.md`

## Existing code inspected

- `src/features/invoices/components/create-invoice-panel.tsx:245-390` — date and price parsing.
- `src/features/invoices/components/create-invoice-panel.tsx:680-950` — line state, catalog query, compliance.
- `src/features/invoices/components/create-invoice-panel.tsx:1040-1080` — submit and save states.
- `src/features/invoices/components/create-invoice-panel.tsx:1420-1590` — client/product selection, row updates, price draft and row scroll.
- `src/features/invoices/components/create-invoice-panel.tsx:2150-2450` — date/client UI.
- `src/features/invoices/components/create-invoice-panel.tsx:2550-3220` — line table, catalog UI, totals, introduction editor.
- `src/features/invoices/components/create-invoice-panel.tsx:3590-3700` — footer save and create controls.
- `src/features/compliance/calculate.ts:1-60,159-300` — subtotal and tax calculations.
- `src/server/data/products.ts:174-225` — workspace-scoped product search.
- `src/server/data/invoices.ts:1348-1365,2202-2230` — workspace invoice template defaults read/write.
- `src/server/data/workspaces.ts:76-120` — verified active workspace settings source.
- `src/features/invoices/types.ts:20-55` — persisted line-item and template fields.
- `src/components/ui/input.tsx:1-42`, `src/components/ui/popover.tsx:1-65`, `src/components/ui/tooltip.tsx:1-40` — shared controls.
- `src/features/invoices/components/create-invoice-panel.responsive.test.ts`, `create-invoice-panel.contract.test.ts` — existing UI contracts.
- `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/invoice/line-items.tsx:145-255` and `product-autocomplete.tsx:1-170` — upstream behaviors.

## Root causes verified before code

1. `max-h-[250px] overflow-y-auto` hides later line rows; add-line focus explicitly scrolls this inner list. Browser verification found a second cause: the flex column shrank the list wrapper to its 52px minimum, so rows overflowed into Subtotal and blocked Add item. The wrapper now has `shrink-0`.
2. Price edits update only `priceDrafts`; `lineItems.price` and `calculateInvoiceCompliance` change on blur. Both row and subtotal multiply major-unit numbers.
3. Shared Input selects text on focus; description has no ellipsis or scroll reset, so a long focused value can show its tail.
4. Product Popover uses up to 560px independent of input width and is portalled.
5. Product query has no debounce, timeout, stale-request abort, visible error, or retry state.
6. Product selection already patches all fields once, but leaves VAT empty when product default is null.
7. Header and row grid templates are duplicated; quantity and price are not consistently right-aligned.
8. Required fields are always in a second row without an inline missing-field message.
9. Workspace Settings has tax status, but no business default VAT category; only products have one.
10. Price draft is raw while editing but returns an ungrouped string on blur.
11. Introduction editor renders after the line-item list.
12. Empty-client card, selector, and manual name/email render together.
13. Submit reason is hidden on narrow screens, lacks a client action, and disabled Create has no tooltip.
14. Due Date always has a brand underline, with no invalid-date message.
15. Quantity and remove controls are 28px; several labels are 11px.
16. Save status mounts conditionally in a wrapping footer and shifts other controls.

## Data flow and trust boundaries

- Verified session user id and Supabase client enter workspace-scoped `searchProducts`, `listClients`, `getTemplateDefaults`, and invoice mutations; the UI cannot authorize workspace access.
- Editor state updates locally; the existing server path validates invoice writes and workspace membership. Catalog search results are private workspace data; no public route or secret handling changes.
- Current runtime uses Supabase workspace helpers and RLS policies; no new table or tenant key. New default VAT preference is stored in the existing active workspace template JSON with existing workspace-scoped reads/writes.

## Files likely to change or be added

- `src/features/invoices/components/create-invoice-panel.tsx`
- `src/features/invoices/components/create-invoice-panel.responsive.test.ts` and focused money/renderer test as needed
- `src/features/compliance/calculate.ts` and focused tests if common subtotal arithmetic changes
- `src/features/invoices/types.ts`
- `src/server/data/products.ts`
- Settings UI for default VAT category, using existing workspace template JSON
- `prompts/invoice-editor-line-items-overhaul.md`

## Implementation requirements

- Use one money calculation in integer kobo or decimal arithmetic for displayed row and subtotal; persist through existing invoice contracts.
- Remove nested line-list scrolling. Anchor search to Description with bounded width, debounce <=300ms, a 5s timeout, abort on stale query, and all requested states.
- Keep required-field feedback in the row. Preserve keyboard access, 32px minimum controls, semantic labels, Wayfare tokens, and 320/375/414/768px usability.
- Keep client creation in the add-client form and make disabled Create reasons available by tooltip and readable footer text.

## Acceptance criteria

- Every P0/P1/P2 behavior in the user request is implemented and verified against code and a focused check.
- With three line items, three rendered rows are visible and Subtotal equals the sum of the visible row totals.
- A screen capture demonstrates adding three items, catalog search, live price updates, unclipped descriptions, aligned headers, and visible rows.
- Focused tests, typecheck, lint, build, and `git diff --check` pass.

## Checks to run

- `pnpm exec vitest run src/features/compliance src/features/invoices/line-money.test.ts src/features/invoices/components/create-invoice-panel.render.test.tsx src/features/invoices/components/create-invoice-panel.responsive.test.ts src/features/invoices/components/create-invoice-panel.contract.test.ts --reporter=dot` — 88 passed.
- `pnpm test -- --reporter=dot` — 637 passed, 86 skipped.
- `pnpm typecheck`
- `pnpm lint` — passed with existing repository warnings.
- `pnpm exec biome check` on touched files — passed with existing warnings in `src/server/data/invoices.ts`.
- `pnpm build`
- `git diff --check`
- Browser screen capture at desktop sheet width and narrow viewports — `artifacts/invoice-editor-line-items.mp4`, `artifacts/invoice-editor-line-items.png`; the local app redirected to sign-in, so the actual editor component was mounted in Chromium with a local draft and mocked catalog cache result. The capture exercises catalog selection, adding three rows, live price edits, and displayed Subtotal. Browser inspection verified the list wrapper contains all three rows and Subtotal starts below it. 320/375/414/768/1100px have three rows and no body horizontal overflow. Authenticated catalog network access was not exercised.

## Scope changes (append-only)

- Initial scope: the user's numbered P0/P1/P2 list and screen-capture acceptance.
