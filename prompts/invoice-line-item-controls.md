# Invoice line item controls

Status: done

## Goal

Fix the invoice composer’s misaligned unit and VAT inputs on narrow screens and use Velure’s shared shadcn Select controls for both dropdowns.

## Decisions / assumptions (confirmed with user)

- User requested the invoice line item fields shown in screenshots to align and use the supplied `src/components/ui/select.tsx` components.
- Keep the change limited to the invoice composer.
- Midday behavior classification: `adapt` — Midday’s invoice UI uses the shared Select in `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/tracker-create-invoice.tsx`; Velure retains its Nigeria-specific unit/VAT options and controlled invoice draft state.

## Skills read

- `/home/asys/.agents/skills/frontend-developer/SKILL.md`
- `/home/asys/.agents/skills/react-ui-patterns/SKILL.md`
- `/home/asys/.agents/skills/accessibility/SKILL.md`
- `/home/asys/.agents/skills/frontend-design/SKILL.md`

## Existing code inspected

- `src/features/invoices/components/create-invoice-panel.tsx:1-115` — imports and editor state types.
- `src/features/invoices/components/create-invoice-panel.tsx:2617-3078` — responsive sortable line item editor and unit/VAT/code controls.
- `src/components/ui/select.tsx:1-163` — shared Radix-backed Select exports and styles.
- `src/features/products/product-form-utils.tsx` — existing VAT category and unit option values.
- `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/tracker-create-invoice.tsx:1-30` — Midday shared Select import pattern.
- `/home/asys/JS-TS/apps/projects/midday-main/apps/dashboard/src/components/forms/product-form.tsx:210-250` — Midday product unit control.
- `AGENTS.md` — required UI sizing, tokens, and prompt trail.

## Files likely to change or be added

- `src/features/invoices/components/create-invoice-panel.tsx`
- `prompts/invoice-line-item-controls.md`

## Implementation requirements

- Use shared shadcn Select primitives for unit and VAT category.
- Use placeholder values without empty SelectItem values; preserve current state values and update behavior.
- Stack metadata controls on narrow viewports and place them in three equal columns at `md` and wider.
- Keep labels associated with trigger IDs and preserve existing tokens.
- UI-only: no persistence, auth, tenancy, schema, or public route changes.

## Acceptance criteria

- Unit and VAT dropdowns render with the shared Select component and retain the existing choices and draft updates. **Done:** both controlled fields use Radix-backed Select primitives.
- At narrow widths, the unit, VAT, and goods/service code fields do not overlap; at `md` and wider they fit in a three-column row. **Done:** metadata fields stack below `md` and use three columns from `md` upward.
- Typecheck, lint for the touched TSX file, and `git diff --check` pass. **Done:** all three checks passed.

## Checks to run

- `pnpm typecheck`
- `pnpm exec biome check src/features/invoices/components/create-invoice-panel.tsx`
- `git diff --check`

## Scope changes (append-only)

- Initial scope: fix the narrow line-item metadata layout and replace its two native dropdowns with the shared Select.
- Governance files `ProductStrategy.md`, `Architecture.md`, `migration-plan.md`, and `prompts/TEMPLATE.md` are referenced by `AGENTS.md` but are absent from this checkout; Midday Obsidian research/handoff notes were not available in the local workspace. This UI-only change does not alter product, tenancy, or migration decisions.
