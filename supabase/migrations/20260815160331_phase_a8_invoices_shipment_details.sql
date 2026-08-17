-- Velure Phase A8 follow-up: invoices.shipment_details.
--
-- The A5 invoices migration did not mirror convex/schema.ts field
-- `shipmentDetails` (shipmentDetailsValidator: hsCode, packageCount,
-- portOfDischarge, portOfLoading, weight). This adds the nullable jsonb column
-- so the A8 data migration can import the single invoice that carries shipment
-- data without dropping it.

alter table public.invoices
  add column shipment_details jsonb;
