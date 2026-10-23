-- WP9 (B6): distinct invoice document types and same-workspace correction links.
-- Replace the enum rather than ALTER TYPE ADD VALUE so the down path can
-- restore the original two values when no correction documents remain.
begin;

alter table public.invoices
  alter column document_type drop default;

alter type public.invoice_document_type rename to invoice_document_type_old;
create type public.invoice_document_type as enum
  ('standard', 'credit_note', 'debit_note', 'proforma');

alter table public.invoices
  alter column document_type type public.invoice_document_type
  using document_type::text::public.invoice_document_type;

alter table public.invoices
  alter column document_type set default 'standard'::public.invoice_document_type;

drop type public.invoice_document_type_old;

-- Composite tenant key lets Postgres reject a correction source from another
-- workspace even if an application check is accidentally bypassed.
alter table public.invoices
  add constraint invoices_id_workspace_id_key unique (id, workspace_id),
  add column corrects_invoice_id uuid null,
  add constraint invoices_correction_source_type_check check (
    (document_type in ('credit_note', 'debit_note') and corrects_invoice_id is not null)
    or (document_type in ('standard', 'proforma') and corrects_invoice_id is null)
  ),
  add constraint invoices_corrects_invoice_same_workspace_fkey
    foreign key (corrects_invoice_id, workspace_id)
    references public.invoices (id, workspace_id)
    on delete restrict;

create index invoices_workspace_corrects_invoice_idx
  on public.invoices (workspace_id, corrects_invoice_id)
  where corrects_invoice_id is not null;

-- The established issued-row guard predates the source-link column, so guard
-- this new content field with a separate narrow trigger without widening its
-- existing bookkeeping allowlist.
create or replace function public.invoice_corrects_source_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if public.invoice_is_issued(old)
     and new.corrects_invoice_id is distinct from old.corrects_invoice_id then
    raise exception
      'Issued invoice % is immutable; correction source cannot be changed (B6).',
      old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger invoices_corrects_source_immutable
before update of corrects_invoice_id on public.invoices
for each row execute function public.invoice_corrects_source_immutable();

commit;

-- Rollback (run as one transaction). First ensure no new enum values or
-- correction links would be lost, then remove the link and replace the enum.
--
-- begin;
-- do $$ begin
--   if exists (select 1 from public.invoices
--              where document_type in ('credit_note', 'debit_note')) then
--     raise exception 'Cannot rollback B6 while credit/debit notes exist';
--   end if;
--   if exists (select 1 from public.invoices where corrects_invoice_id is not null) then
--     raise exception 'Cannot rollback B6 while correction links exist';
--   end if;
-- end $$;
-- drop index public.invoices_workspace_corrects_invoice_idx;
-- drop trigger invoices_corrects_source_immutable on public.invoices;
-- drop function public.invoice_corrects_source_immutable();
-- alter table public.invoices
--   drop constraint invoices_corrects_invoice_same_workspace_fkey,
--   drop constraint invoices_correction_source_type_check,
--   drop column corrects_invoice_id,
--   drop constraint invoices_id_workspace_id_key,
--   alter column document_type drop default;
-- alter type public.invoice_document_type rename to invoice_document_type_new;
-- create type public.invoice_document_type as enum ('standard', 'proforma');
-- alter table public.invoices
--   alter column document_type type public.invoice_document_type
--   using document_type::text::public.invoice_document_type;
-- alter table public.invoices
--   alter column document_type set default 'standard'::public.invoice_document_type;
-- drop type public.invoice_document_type_new;
-- commit;
