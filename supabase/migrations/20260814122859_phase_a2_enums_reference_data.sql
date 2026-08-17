-- Velure Phase A2: closed Convex validators and global jurisdiction data.

create type public.tax_treatment as enum (
  'none',
  'exclusive_rate',
  'inclusive_rate',
  'reverse_charge',
  'exempt',
  'zero_rated'
);

create type public.seller_tax_status as enum (
  'vat_registered',
  'below_threshold_not_charging_vat',
  'statutorily_exempt'
);

create type public.withholding_tax_preset as enum (
  'none',
  'contracts_supplies',
  'consultancy_company',
  'consultancy_individual',
  'rent_interest'
);

create type public.withholding_category as enum (
  'none',
  'goods_materials',
  'general_services',
  'professional_fees',
  'major_construction',
  'other_construction',
  'telecom_colocation',
  'brokerage',
  'rent_hire_lease'
);

create type public.withholding_recipient_entity_type as enum (
  'corporate',
  'non_corporate'
);

create type public.withholding_recipient_residency as enum (
  'resident',
  'non_resident'
);

create type public.compliance_warning as enum (
  'missing_seller_tax_id',
  'missing_buyer_tax_id',
  'cross_border_review',
  'reverse_charge_review',
  'unknown_jurisdiction',
  'domestic_vat_not_applied',
  'missing_workspace_tax_status',
  'manual_tax_override',
  'manual_wht_override',
  'legacy_wht_mapping'
);

create type public.provider as enum ('quickbooks', 'xero', 'slack');

create type public.invoice_status as enum (
  'draft',
  'unpaid',
  'partially-paid',
  'paid',
  'overdue',
  'canceled',
  'scheduled'
);

create type public.invoice_document_type as enum ('standard', 'proforma');

create type public.payment_source as enum ('manual', 'paystack');

create type public.payment_charge_status as enum (
  'pending',
  'succeeded',
  'failed',
  'expired',
  'manual_review'
);

create type public.sync_status as enum (
  'idle',
  'pending',
  'success',
  'failed',
  'needs_configuration'
);

create type public.reminder_stage as enum (
  'none',
  'before_due',
  'due_date',
  'overdue_1',
  'overdue_2',
  'overdue_3',
  'escalated'
);

create type public.escalation_status as enum (
  'idle',
  'queued',
  'sent',
  'manual_review'
);

create type public.workspace_role as enum ('owner', 'member', 'viewer');

create type public.invoice_number_mode as enum ('prefix', 'business_name');

create type public.recurring_frequency as enum ('monthly', 'quarterly');

create type public.recurring_schedule_status as enum (
  'active',
  'paused',
  'ended'
);

create type public.recurring_run_status as enum ('created', 'skipped', 'failed');

create type public.email_event_type as enum (
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'opened',
  'clicked',
  'failed'
);

create type public.job_status as enum ('success', 'failure');

create type public.audit_action as enum (
  'invoice.created',
  'invoice.edited',
  'invoice.deleted',
  'invoice.renumbered',
  'invoice.paid',
  'invoice.partially_paid',
  'invoice.sent',
  'invoice.viewed',
  'invoice.converted',
  'invoice.schedule_canceled',
  'invoice.rescheduled',
  'collection.session.created',
  'collection.session.expired',
  'payment.initiated',
  'payment.received',
  'payment.failed',
  'reminder.sent',
  'oauth.connected',
  'integration.synced',
  'export.created',
  'export.retried',
  'workspace.changed',
  'workspace.selected'
);

create type public.audit_result as enum ('success', 'failure');

grant usage on type
  public.tax_treatment,
  public.seller_tax_status,
  public.withholding_tax_preset,
  public.withholding_category,
  public.withholding_recipient_entity_type,
  public.withholding_recipient_residency,
  public.compliance_warning,
  public.provider,
  public.invoice_status,
  public.invoice_document_type,
  public.payment_source,
  public.payment_charge_status,
  public.sync_status,
  public.reminder_stage,
  public.escalation_status,
  public.workspace_role,
  public.invoice_number_mode,
  public.recurring_frequency,
  public.recurring_schedule_status,
  public.recurring_run_status,
  public.email_event_type,
  public.job_status,
  public.audit_action,
  public.audit_result
to authenticated;

create table public.jurisdictions (
  code text primary key check (code in ('NG', 'GH', 'KE', 'ZA', 'US', 'GB', 'EU', 'OTHER')),
  name text not null,
  default_tax_label text not null,
  supports_reverse_charge boolean not null,
  supports_vat boolean not null,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.jurisdictions enable row level security;

revoke all on table public.jurisdictions from anon, authenticated;
grant select on table public.jurisdictions to authenticated;

create policy "authenticated users can read jurisdictions"
on public.jurisdictions
for select
to authenticated
using (true);

insert into public.jurisdictions (
  code,
  name,
  default_tax_label,
  supports_reverse_charge,
  supports_vat,
  notes
)
values
  ('NG', 'Nigeria', 'VAT', true, true, 'Nigeria-first default setup.'),
  ('GH', 'Ghana', 'VAT', false, true, 'Regional expansion target.'),
  ('KE', 'Kenya', 'VAT', true, true, 'Regional expansion target.'),
  ('ZA', 'South Africa', 'VAT', true, true, 'Regional expansion target.'),
  ('US', 'United States', 'Sales Tax', false, false, 'Accounting export support only in v1.'),
  ('GB', 'United Kingdom', 'VAT', true, true, 'VAT-ready template skeleton.'),
  ('EU', 'European Union', 'VAT', true, true, 'VAT-ready template skeleton.'),
  ('OTHER', 'Other', 'Tax', false, false, 'Review with an accountant before issuing invoices.');
