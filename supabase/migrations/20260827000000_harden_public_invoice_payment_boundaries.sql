-- Distributed fixed-window limiter for public provider-backed operations.
-- Identifiers are SHA-256 hashes; raw invoice tokens and IP addresses are not stored.

create table public.public_rate_limit_windows (
  key_hash text not null check (length(key_hash) = 64),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (key_hash, window_start)
);
create index public_rate_limit_windows_start_idx
  on public.public_rate_limit_windows (window_start);

alter table public.public_rate_limit_windows enable row level security;
revoke all on table public.public_rate_limit_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.public_rate_limit_windows
  to service_role;

create or replace function public.consume_public_rate_limit(
  input_key_hash text,
  input_limit integer,
  input_window_start timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if input_key_hash !~ '^[0-9a-f]{64}$' or input_limit < 1 or input_limit > 1000 then
    raise exception 'Invalid rate limit input.';
  end if;

  delete from public.public_rate_limit_windows
  where window_start < input_window_start - interval '1 day';

  loop
    select request_count into current_count
    from public.public_rate_limit_windows
    where key_hash = input_key_hash and window_start = input_window_start
    for update;

    if found then
      if current_count >= input_limit then return false; end if;
      update public.public_rate_limit_windows
      set request_count = request_count + 1
      where key_hash = input_key_hash and window_start = input_window_start;
      return true;
    end if;

    begin
      insert into public.public_rate_limit_windows (key_hash, window_start, request_count)
      values (input_key_hash, input_window_start, 1);
      return true;
    exception when unique_violation then
      -- A concurrent request created the window; lock and retry it.
    end;
  end loop;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer, timestamptz)
  to service_role;

create or replace function public.public_invoice_by_token(input_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'countryCode', w.country_code,
    'invoice', jsonb_build_object(
      'id', i.id,
      'token', i.token,
      'document_type', i.document_type,
      'shipment_details', i.shipment_details,
      'invoice_number', i.invoice_number,
      'customer_name', i.customer_name,
      'logo_url', i.logo_url,
      'customer_po_number', i.customer_po_number,
      'currency', i.currency,
      'invoice_type', i.invoice_type,
      'invoice_size', i.invoice_size,
      'date_format', i.date_format,
      'payment_terms_days', i.payment_terms_days,
      'template', i.template,
      'issue_date', i.issue_date,
      'due_date', i.due_date,
      'status', i.status,
      'payment_amount', i.payment_amount,
      'delivered_at', i.delivered_at,
      'canceled_at', i.canceled_at,
      'payment_details', i.payment_details,
      'payment_link', i.payment_link,
      'payment_provider', i.payment_provider,
      'paid_at', i.paid_at,
      'payment_reference', i.payment_reference,
      'finalized_at', i.finalized_at,
      'scheduled_at', i.scheduled_at,
      'schedule_version', i.schedule_version,
      'notes', i.notes,
      'line_items', i.line_items,
      'template_settings', i.template_settings,
      'top_block', i.top_block,
      'bottom_block', i.bottom_block,
      'compliance', i.compliance,
      'fiscalization', i.fiscalization,
      'lifecycle', i.lifecycle,
      'created_at', i.created_at,
      'updated_at', i.updated_at
    )
  )
  from public.invoices i
  join public.workspaces w on w.id = i.workspace_id
  where i.token = input_token
    and i.deleted_at is null
    and i.canceled_at is null
    and i.token_revoked_at is null;
$$;

revoke execute on function public.public_invoice_by_token(text)
  from public, anon, authenticated;
grant execute on function public.public_invoice_by_token(text) to service_role;
