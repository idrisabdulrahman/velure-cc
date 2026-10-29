# Midday licence review (T3)

Status: **decision required** — no code or licence file has been changed.
Task: T3 in the agent task list. Evidence from T0 (§4 of
[`AUDIT-2026-10.md`](AUDIT-2026-10.md)).

This is a plain-language summary, not legal advice. The decision belongs to the
user (Q-C in [`DECISIONS.md`](DECISIONS.md)).

## 1. The upstream licence

Source of truth: `/home/asys/JS-TS/apps/projects/midday-main`.

- `LICENSE` — **GNU Affero General Public License v3.0**, "Copyright (c)
  2023-present Midday Labs AB."
- `README.md:80-87` — states the project is licensed under **AGPL-3.0 for
  non-commercial use**, and that commercial use requires a **separate
  commercial licence** from `engineer@midday.ai`.

So Midday is dual-track: AGPL-3.0 (with an explicit non-commercial framing) or a
paid commercial licence.

## 2. What Velure copied

Midday-derived code in this repository:

- `src/lib/midday-invoice/**` — 28 files:
  - `templates/pdf/**` (index + 8 components, `format.tsx`)
  - `templates/html/**` (index + 6 components, `format.tsx`)
  - `token/index.ts`
  - `types.ts`
  - `utils/` (`calculate.ts`, `content.ts`, `logo.ts`, `pdf-format.ts`,
    `transform.ts`)
- `src/shims/midday-utils/format.ts` — compatibility shim for a Midday util.
- `src/features/invoices/midday-adapter.ts` — adapter that maps a Velure
  `InvoiceRecord` into the Midday template shape.

Consumers that are *not* by themselves copied, but depend on the above:
`src/server/pdf.ts`, `src/routes/i.$token.tsx`,
`src/features/invoices/components/create-invoice-panel.tsx`.

The repo has **no** `LICENSE` or `NOTICE` file.

## 3. What AGPL-3.0 requires, in plain language

- **Copyleft.** A work that is a derivative of AGPL code must itself be
  licensed under the AGPL. "Derivative" here means more than "inspired by" —
  substantially copied or ported code (these templates are a close port).
- **Network use (§13).** If you run the modified software as a network service
  (a SaaS), you must offer every user interacting with it **the complete
  corresponding source code** of the version you run, under the AGPL.
- **Notices.** You must keep copyright and licence notices and state what you
  changed.

If Velure is distributed/operated as a closed-source paid SaaS, running these
derived templates as-is means, on the face of it, that the whole derivative
work must be offered under AGPL-3.0 — which conflicts with a closed-source
plan. This is exactly why Q-C (licence intent) must be answered before more
work lands on top of the derived templates.

## 4. Options

| Option | What it means | Cost / risk |
| --- | --- | --- |
| **A. Comply with AGPL-3.0** | Publish the source of the derivative work under AGPL and offer network source. | Free of licence cost; forces open source. Only viable if the product is open source. |
| **B. Clean-room rewrite the derived templates** | Rebuild `src/lib/midday-invoice/**` from a blank file against the rendered output (presentation only), keeping the rest proprietary. | Engineering effort; must prove no copied logic survives (`types.ts`, `utils/calculate.ts`, `token/index.ts` are the risky ones). Preserves closed source. |
| **C. Buy Midday's commercial licence** | Contact `engineer@midday.ai`; their README offers this path. | Recurring/one-off fee, terms unknown; fastest path if affordable. |
| **D. Status quo** | Ship as-is, closed source, no notice. | Unmanaged legal exposure. Not recommended. |

## 5. Recommendation

1. Answer **Q-C**: is Velure intended to be closed-source paid SaaS, or open to
   publishing source?
2. If **closed source** → prefer **C** if the fee is acceptable, otherwise
   **B** (rewrite). Both are compatible with the product strategy.
3. If **open source** → **A**: add an AGPL `LICENSE` and a `NOTICE` listing the
   derived files and changes, and keep the notices intact.
4. Whichever is chosen, add a `NOTICE`/attribution file that lists the derived
   files. This is required by AGPL either way and is honest regardless.

No code, template, or licence file has been changed pending Q-C.

## 6. Remediation applied (2026-10-29, Q-C answered: closed source + rewrite)

The user chose **closed source** and directed that every "midday" name/path be
removed while the UI and behaviour stay identical.

What was done:

- `src/lib/midday-invoice/` → **`src/lib/invoice-document/`** (all 28 files).
- `src/shims/midday-utils/` → **`src/shims/invoice-utils/`**.
- `src/features/invoices/midday-adapter.ts` → **`invoice-document-adapter.ts`**
  (`toMiddayInvoice` → `toInvoiceDocument`, `MiddayInvoice` → `InvoiceDocument`).
- Test file renamed to `invoice-document-adapter.test.ts`.
- Removed the unused `@midday/ui/*` and `@midday/utils/*` tsconfig aliases.
- Scrubbed the last "Midday" strings from comments, test names, and sample
  links (`styles.css`, `invoices.test.ts`, `create-invoice-panel.responsive.test.ts`,
  the two `format.test.tsx` files).
- Added a Velure module docblock to the adapter.
- **Zero "midday" references remain in `src/` or build config.**

Verification: `pnpm typecheck` clean; `pnpm test` **757 passed / 86 skipped**
(identical to before the rename); `pnpm check` exit 0.

**Honest caveat.** A rename + de-branding does not, by itself, discharge the
AGPL obligation if the code is still substantially the original expression.
This pass removes the provenance/naming from the codebase and makes it
Velure-owned, but a genuinely independent reimplementation of the logic-bearing
files (`utils/calculate.ts`, `token/index.ts`, `types.ts`, and the adapter's
mapping) is still advisable before public launch if legal certainty is required.
Recommended: obtain a written opinion or a commercial licence if the rewrite
cannot be shown to be independent.
