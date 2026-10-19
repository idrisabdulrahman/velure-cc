-- Velure e-invoicing B2: buyer profile fields + non-destructive flags
-- (docs/e-invoicing/SPEC.md §5.B row B2, §6.2 item 7).
--
-- Adds the B2B/B2C buyer type and buyer-profile flag columns to clients.
-- Existing name / email / billing_address / tax_id values are NEVER modified
-- or deleted: the backfill only writes buyer_profile_status and
-- buyer_profile_issues. Values stay byte-for-byte as the user left them so a
-- flagged buyer can be fixed through the clients UI.
--
-- buyer_type: 'b2b' (default) or 'b2c'. Every pre-existing row is backfilled
--   as 'b2b' by the column default: Velure's core motion is business
--   invoicing, and treating legacy buyers as B2B makes their missing TIN
--   (SPEC §3.1 P3: "name, TIN for B2B") visible through the flag columns.
-- buyer_profile_status: 'needs_review' (default) or 'complete'.
-- buyer_profile_issues: jsonb array of issue codes shared with
--   src/features/clients/buyer-profile.ts.

alter table public.clients
  add column buyer_type text not null default 'b2b'
    check (buyer_type in ('b2b', 'b2c')),
  add column buyer_profile_status text not null default 'needs_review'
    check (buyer_profile_status in ('complete', 'needs_review')),
  add column buyer_profile_issues jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(buyer_profile_issues) = 'array'
    );

-- Flag-only backfill. Name and email are already NOT NULL + validated at the
-- server boundary, so the only issues a pre-existing row can carry are the
-- missing address and the TIN rules (applied because every pre-existing row
-- is b2b via the column default). No existing column is written.
update public.clients c
set buyer_profile_status = 'needs_review',
    buyer_profile_issues = coalesce(
      (
        select jsonb_agg(v.issue)
        from (
          values
            (case
              when btrim(coalesce(c.billing_address, '')) = ''
                then 'address_required'
              else null
            end),
            (case
              when btrim(coalesce(c.tax_id, '')) = ''
                then 'tin_required'
              when not btrim(coalesce(c.tax_id, '')) ~ '^[0-9]{10}$'
                then 'tin_format'
              when btrim(coalesce(c.tax_id, '')) in
                     ('1234567890', '0123456789', '9876543210')
                   or btrim(coalesce(c.tax_id, '')) ~ '^(.)\1{9}$'
                then 'tin_placeholder'
              else null
            end)
        ) as v(issue)
        where v.issue is not null
      ),
      '[]'::jsonb
    );

-- Reversal (run manually if this migration must be undone; restores the
-- schema only — the backfill wrote nothing outside the new flag columns, so
-- no user data needs restoring):
--
-- alter table public.clients
--   drop column buyer_type,
--   drop column buyer_profile_status,
--   drop column buyer_profile_issues;
