-- Velure e-invoicing B1: supplier profile validation flags
-- (docs/e-invoicing/SPEC.md §5.B row B1, §6.2 item 4).
--
-- Adds structured-address columns and a non-destructive supplier profile
-- flag. Existing tax_id / rc_number / address values are FLAGGED, never
-- modified or deleted: the backfill only writes supplier_profile_status and
-- supplier_profile_issues. Values stay byte-for-byte as the user left them so
-- a flagged profile can be fixed through the settings form.
--
-- supplier_profile_status: 'needs_review' (default) or 'complete'.
-- supplier_profile_issues: jsonb array of issue codes shared with
--   src/features/compliance/supplier-profile.ts.

alter table public.workspaces
  add column address_street text check (
    address_street is null or char_length(address_street) <= 300
  ),
  add column address_lga text check (
    address_lga is null or char_length(address_lga) <= 200
  ),
  add column address_state text check (
    address_state is null or char_length(address_state) <= 200
  ),
  add column supplier_profile_status text not null default 'needs_review'
    check (supplier_profile_status in ('complete', 'needs_review')),
  add column supplier_profile_issues jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(supplier_profile_issues) = 'array'
    );

-- Flag-only backfill. Every pre-existing profile has a free-text address at
-- best (address_street is null), so it is flagged needs_review with the
-- issues its current values already have. No existing column is written.
update public.workspaces w
set supplier_profile_status = 'needs_review',
    supplier_profile_issues = coalesce(
      (
        select jsonb_agg(v.issue)
        from (
          values
            (case
              when btrim(coalesce(w.address, '')) = ''
                then 'address_street_required'
              else 'address_not_structured'
            end),
            (case
              when w.country_code = 'NG'
                   and btrim(coalesce(w.tax_id, '')) = ''
                then 'tin_required'
              when w.country_code = 'NG'
                   and not btrim(coalesce(w.tax_id, '')) ~ '^[0-9]{10}$'
                then 'tin_format'
              when w.country_code = 'NG'
                   and (
                     btrim(coalesce(w.tax_id, '')) in
                       ('1234567890', '0123456789', '9876543210')
                     or btrim(coalesce(w.tax_id, '')) ~ '^(.)\1{9}$'
                   )
                then 'tin_placeholder'
              else null
            end),
            (case
              when w.country_code = 'NG'
                   and btrim(coalesce(w.rc_number, '')) = ''
                then 'cac_rc_required'
              when w.country_code = 'NG'
                   and not btrim(coalesce(w.rc_number, '')) ~* '^RC-?[0-9]{7}$'
                then 'cac_rc_format'
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
-- alter table public.workspaces
--   drop column address_street,
--   drop column address_lga,
--   drop column address_state,
--   drop column supplier_profile_status,
--   drop column supplier_profile_issues;
