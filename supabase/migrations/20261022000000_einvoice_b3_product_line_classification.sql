-- WP7 (B3): catalog defaults used to create immutable invoice line snapshots.
-- Existing products remain nullable until a user classifies them.
alter table public.products
  add column default_vat_category text
    check (default_vat_category is null or default_vat_category in ('standard', 'zero_rated', 'exempt')),
  add column default_classification_code text
    check (default_classification_code is null or btrim(default_classification_code) <> '');

-- Rollback: alter table public.products drop column default_classification_code;
-- Rollback: alter table public.products drop column default_vat_category;
