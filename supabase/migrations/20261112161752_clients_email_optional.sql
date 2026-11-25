-- Velure: the buyer record's email is optional.
--
-- Issue #3 finding 4 (confirmed 2026-11-12). The only place an email is truly
-- required is email delivery: a freelancer sharing an invoice as a PDF or a
-- public link must not be forced to invent an address for the customer first.
-- So `clients.email` stops being NOT NULL and a name-only buyer saves. A
-- missing email is still flagged `needs_review` by the buyer-profile validator
-- and is rejected at the send/schedule boundary (`assertSendCustomerGate`).
-- A present-but-malformed email keeps failing validation.
--
-- Rollback (reversible): backfill the empty string, then restore NOT NULL.
--   update public.clients set email = '' where email is null;
--   alter table public.clients alter column email set not null;
-- The backfill is lossy by nature (it writes '' where there was no email), so
-- run it only when the optional-email behavior is being withdrawn. The
-- `clients_workspace_email_idx` index is non-unique, so empty strings collide
-- safely.

alter table public.clients
  alter column email drop not null;

comment on column public.clients.email is
  'Buyer email. Optional on the buyer record; required only for email delivery.';