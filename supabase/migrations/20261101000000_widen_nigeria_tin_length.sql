-- Velure e-invoicing: widen the Nigerian TIN length rule to 10-12 digits
-- (docs/e-invoicing/SPEC.md §6.2 item 4; B1/B2 profile flags).
--
-- The B1 supplier backfill
-- (20261016000001_supplier_profile_validation_flags.sql) and the B2 buyer
-- backfill (20261019000000_einvoice_b2_buyer_profile_flags.sql) are already
-- applied and pin the historical 10-digit rule. They are never edited; this
-- migration carries the widened rule for the rows those backfills flagged.
--
-- The TIN rule is a FORMAT check computed in application code on every save
-- (src/features/compliance/supplier-profile.ts). These flag columns are a
-- derived cache that self-heals on the next save, so this migration is a
-- correctness guarantee for already-flagged rows, not a data fix.
--
-- Scope: ONLY rows already flagged 'tin_format'. A fresh workspace with the
-- column-default 'needs_review' + empty issue list is never touched. The TIN
-- code is recomputed with the app's order (length first, then placeholder) and
-- every non-TIN issue code is preserved. Flag-only writes; idempotent via
-- `is distinct from`.

-- Supplier workspaces.
with reclassified as (
  select w.id,
         (
           select coalesce(jsonb_agg(issue), '[]'::jsonb)
           from jsonb_array_elements_text(w.supplier_profile_issues) as t(issue)
           where issue <> 'tin_format'
         ) || (
           case
             when not btrim(coalesce(w.tax_id, '')) ~ '^[0-9]{10,12}$'
               then '["tin_format"]'::jsonb
             when btrim(coalesce(w.tax_id, '')) in
                  ('1234567890', '0123456789', '9876543210')
                  or btrim(coalesce(w.tax_id, '')) ~ '^(.)\1{9,11}$'
               then '["tin_placeholder"]'::jsonb
             else '[]'::jsonb
           end
         ) as issues
  from public.workspaces w
  where w.country_code = 'NG'
    and w.supplier_profile_issues @> '["tin_format"]'::jsonb
)
update public.workspaces w
set supplier_profile_issues = reclassified.issues,
    supplier_profile_status = case
      when jsonb_array_length(reclassified.issues) = 0 then 'complete'
      else 'needs_review'
    end
from reclassified
where reclassified.id = w.id
  and (
    w.supplier_profile_issues is distinct from reclassified.issues
    or w.supplier_profile_status is distinct from
       (case
          when jsonb_array_length(reclassified.issues) = 0 then 'complete'
          else 'needs_review'
        end)
  );

-- Buyer clients.
with reclassified as (
  select c.id,
         (
           select coalesce(jsonb_agg(issue), '[]'::jsonb)
           from jsonb_array_elements_text(c.buyer_profile_issues) as t(issue)
           where issue <> 'tin_format'
         ) || (
           case
             when not btrim(coalesce(c.tax_id, '')) ~ '^[0-9]{10,12}$'
               then '["tin_format"]'::jsonb
             when btrim(coalesce(c.tax_id, '')) in
                  ('1234567890', '0123456789', '9876543210')
                  or btrim(coalesce(c.tax_id, '')) ~ '^(.)\1{9,11}$'
               then '["tin_placeholder"]'::jsonb
             else '[]'::jsonb
           end
         ) as issues
  from public.clients c
  where c.buyer_profile_issues @> '["tin_format"]'::jsonb
)
update public.clients c
set buyer_profile_issues = reclassified.issues,
    buyer_profile_status = case
      when jsonb_array_length(reclassified.issues) = 0 then 'complete'
      else 'needs_review'
    end
from reclassified
where reclassified.id = c.id
  and (
    c.buyer_profile_issues is distinct from reclassified.issues
    or c.buyer_profile_status is distinct from
       (case
          when jsonb_array_length(reclassified.issues) = 0 then 'complete'
          else 'needs_review'
        end)
  );

-- Reversal (run manually if this migration must be undone). This migration
-- changes no schema and no TIN value: it only rewrites the derived profile
-- flag columns. To restore the pre-widening flags, re-run the 10-digit
-- classifier for the same rows:
--
-- with reflagged as (
--   select w.id,
--          (
--            select coalesce(jsonb_agg(issue), '[]'::jsonb)
--            from jsonb_array_elements_text(w.supplier_profile_issues) as t(issue)
--            where issue <> 'tin_placeholder'
--          ) || (
--            case
--              when not btrim(coalesce(w.tax_id, '')) ~ '^[0-9]{10}$'
--                then '["tin_format"]'::jsonb
--              when btrim(coalesce(w.tax_id, '')) in
--                   ('1234567890', '0123456789', '9876543210')
--                   or btrim(coalesce(w.tax_id, '')) ~ '^(.)\1{9}$'
--                then '["tin_placeholder"]'::jsonb
--              else '[]'::jsonb
--            end
--          ) as issues
--   from public.workspaces w
-- )
-- update public.workspaces w
-- set supplier_profile_issues = reflagged.issues,
--     supplier_profile_status = case
--       when jsonb_array_length(reflagged.issues) = 0 then 'complete'
--       else 'needs_review'
--     end
-- from reflagged
-- where reflagged.id = w.id
--   and w.supplier_profile_issues is distinct from reflagged.issues;
--
-- (Repeat for public.clients / buyer_profile_issues to restore buyer flags.)
