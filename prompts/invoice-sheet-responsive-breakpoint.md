# Invoice sheet responsive line items

Status: done

## Goal

Fix the invoice sheet line-item fields overlapping when the sheet is narrow on a desktop viewport.

## Decisions / assumptions (confirmed with user)

- The supplied recording shows the line-item unit, VAT, and goods/service code fields crowding the quantity controls inside the create invoice sheet.
- The sheet is capped at 600px while its CSS layout currently switches at the full viewport `md` breakpoint. Make line-item layout respond to composer width.
- Midday behavior classification: `adapt` — use the existing Velure invoice composer and shared controls; keep the narrow sheet readable without changing invoice behavior.

## Skills read

- `/home/asys/.agents/skills/debug/SKILL.md`
- `/home/asys/.agents/skills/frontend-developer/SKILL.md`
- `/home/asys/.agents/skills/react-ui-patterns/SKILL.md`
- `/home/asys/.agents/skills/accessibility/SKILL.md`
- `/home/asys/.agents/skills/frontend-design/SKILL.md`

## Existing code inspected

- `src/features/invoices/components/create-invoice-panel.tsx:487-495` — sheet mode selection.
- `src/features/invoices/components/create-invoice-panel.tsx:2052` — composer scroll container.
- `src/features/invoices/components/create-invoice-panel.tsx:2550-3085` — line-item column headings and responsive line-item controls.
- `src/features/invoices/components/create-invoice-sheet.tsx:20-46` — sheet width and shared panel caller.
- `src/components/ui/sheet.tsx:25-39` — right sheet width variants.
- `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/tracker-create-invoice.tsx:1-30` — shared Select pattern for parity context.
- User recording `/home/asys/Videos/recording_2026-10-25_12.52.30.mp4`, 504x416 video frames.

## Files likely to change or be added

- `src/features/invoices/components/create-invoice-panel.tsx`
- `src/features/invoices/components/create-invoice-panel.responsive.test.ts`
- `prompts/invoice-sheet-responsive-breakpoint.md`

## Implementation requirements

- Use a local container query for line-item headings and row layout so the sheet responds to its own width, not the desktop viewport.
- Keep quantity/price/total and metadata fields readable at narrow container widths; preserve three-column metadata on a sufficiently wide composer.
- Preserve keyboard access, labels, existing draft state, shared Select controls, and design tokens.
- No data, auth, tenancy, schema, public route, or persistence changes. No user ownership data is involved.

## Acceptance criteria

- At a 504px sheet width on a desktop viewport, line-item controls use the narrow layout and do not overlap. **Done:** the sheet content width is below the generated 28rem container breakpoint after desktop padding.
- At a wide composer width, existing desktop columns remain available. **Done:** the 28rem container query enables the existing three-column layout for wider composer content.
- The focused responsive contract test, typecheck, lint, diff check, and build pass. **Done:** the focused responsive contract test passes after updating its assertions from viewport breakpoints to composer container breakpoints.

## Checks to run

- `pnpm exec vitest run src/features/invoices/components/create-invoice-panel.responsive.test.ts`
- `pnpm typecheck`
- `pnpm exec biome check src/features/invoices/components/create-invoice-panel.tsx`
- `git diff --check`
- `pnpm build` (also confirms Tailwind emits the container query rules)

## Scope changes (append-only)

- Initial scope: correct line-item responsive breakpoints in the invoice composer based on the supplied recording.
