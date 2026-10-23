-- C3 — audit taxonomy gains `invoice.delete`
-- (SPEC §5.C row C3: every blocked edit/delete/cancel attempt and every
--  issuance is logged through the ONE G1 audit service).
--
-- WP8 adds the `invoice.delete` action so hard deletes (draft cleanup,
-- bulk cleanup) and blocked delete attempts on issued invoices have their
-- own action value instead of overloading `invoice.edit`. The TypeScript
-- taxonomy in src/server/data/audit.ts (INVOICE_AUDIT_ACTIONS) grows in
-- lockstep, and the audit POST route derives its zod enum from it.
--
-- The audit log is append-only, so the down section re-adds the original
-- five-action CHECK as NOT VALID: existing rows — `invoice.delete` entries
-- included — are preserved untouched, and only new rows are held to the
-- narrower set.

alter table public.invoice_audit_log
  drop constraint invoice_audit_log_action_check;

alter table public.invoice_audit_log
  add constraint invoice_audit_log_action_check check (action in (
    'invoice.create',
    'invoice.edit',
    'invoice.send',
    'invoice.cancel',
    'invoice.export',
    'invoice.delete'
  ));

-- down (reversible): restore the pre-WP8 five-action set without touching
-- any stored row (NOT VALID keeps historical invoice.delete entries valid).
-- Uncomment to apply.
-- alter table public.invoice_audit_log
--   drop constraint invoice_audit_log_action_check;
-- alter table public.invoice_audit_log
--   add constraint invoice_audit_log_action_check check (action in (
--     'invoice.create',
--     'invoice.edit',
--     'invoice.send',
--     'invoice.cancel',
--     'invoice.export'
--   )) not valid;
