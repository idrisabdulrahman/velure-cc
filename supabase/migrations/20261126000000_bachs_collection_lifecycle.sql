-- Bachs collection lifecycle: record failed / expired / manual-review outcomes
-- on the charge so reconciliation sees them, without ever cancelling the
-- invoice or blocking a later success.
--
-- Why this is safe for money:
--   * A succeeded charge is never downgraded. `confirm_bachs_payment` still
--     matches a charge by reference with no status filter, so a bank transfer
--     that lands after `checkout.expired` can still settle that reference.
--   * `collection.failed` is explicitly non-final (Bachs keeps the checkout
--     open), so it records the provider status but leaves the charge pending.
--   * `expired` only closes the charge when it is still pending.
--   * `manual_review` (ACCEPTED / OVERPAID) never touches the invoice balance;
--     it parks the charge for a person to reconcile.
--
-- Down migration:
--   drop function if exists public.record_bachs_payment_outcome(
--     text, text, text, text, text, text, text, jsonb);
--   -- Audit rows written by this function are append-only history and stay.

create or replace function public.record_bachs_payment_outcome(
  input_reference text,
  input_account text,
  input_event_type text,
  input_provider_status text,
  input_outcome text,
  input_reason text default null,
  input_provider_payment_id text default null,
  input_raw_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  charge public.payment_charges;
  next_status public.payment_charge_status;
  audit_action public.audit_action;
begin
  if input_outcome not in ('failed', 'expired', 'manual_review') then
    return jsonb_build_object(
      'ok', false, 'reason', 'invalid_outcome', 'reference', input_reference
    );
  end if;

  select * into charge from public.payment_charges
  where provider = 'bachs' and reference = input_reference
    and raw_response->>'account' = input_account for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'reason', 'unknown_reference', 'reference', input_reference
    );
  end if;

  -- Settled money wins over any late lifecycle event.
  if charge.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true, 'ignored', true, 'reason', 'already_settled',
      'reference', input_reference
    );
  end if;

  if input_outcome = 'failed' then
    -- Not final: keep the charge pending so the buyer can retry.
    next_status := charge.status;
    audit_action := 'payment.failed';
  elsif input_outcome = 'expired' then
    -- Close only a still-pending charge; a manually-reviewed charge keeps its
    -- state so the review queue does not lose the reason.
    next_status := case
      when charge.status = 'pending' then 'expired'::public.payment_charge_status
      else charge.status
    end;
    audit_action := 'collection.session.expired';
  else
    -- ACCEPTED / OVERPAID / currency mismatch: money moved but not on the
    -- exact terms, so this is a received payment that needs a person, not a
    -- failure.
    next_status := 'manual_review'::public.payment_charge_status;
    audit_action := 'payment.received';
  end if;

  update public.payment_charges
  set status = next_status,
      provider_status = coalesce(input_provider_status, provider_status),
      provider_message = coalesce(input_reason, provider_message),
      updated_at = now()
  where id = charge.id;

  insert into public.audit_logs (
    workspace_id, actor_id, actor_type, action,
    resource_type, resource_id, result, message, metadata
  ) values (
    charge.workspace_id,
    null,
    'system',
    audit_action,
    'invoice',
    charge.invoice_id::text,
    case when input_outcome = 'failed' then 'failure'::public.audit_result
         else 'success'::public.audit_result end,
    'Bachs reported a ' || input_outcome || ' collection for ' || input_reference ||
      coalesce(' (' || input_reason || ')', '') || '.',
    jsonb_build_object(
      'provider', 'bachs',
      'reference', input_reference,
      'event_type', input_event_type,
      'provider_status', input_provider_status,
      'provider_payment_id', input_provider_payment_id,
      'outcome', input_outcome
    )
  );

  return jsonb_build_object(
    'ok', true, 'ignored', false,
    'status', next_status::text, 'reference', input_reference
  );
end;
$$;

revoke execute on function public.record_bachs_payment_outcome(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_bachs_payment_outcome(text, text, text, text, text, text, text, jsonb) to service_role;