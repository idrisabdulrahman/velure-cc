create unique index if not exists email_events_provider_event_unique_idx
  on public.email_events (provider, provider_event_id)
  where provider_event_id is not null;
