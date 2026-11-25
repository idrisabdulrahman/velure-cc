# E-Invoicing Gap Analysis — canonical model vs the real NRS/MBS schema

Task: T6 of `Task List.md` (Phase 2+, real e-invoicing groundwork).
Written 2026-10-30. Read-only research; no code, schema or customer-facing copy
was changed by this task.

> **Not legal or tax advice. Nothing here claims NRS compliance or clearance.**
> This document maps Velure's internal canonical model against what is
> *officially published* about the NRS/MBS schema. Where a field is not covered
> by a public source it is marked **UNKNOWN**, never guessed.

## 1. Purpose and hard rules

T6 asks one question: **how far is the internal canonical invoice model from the
real NRS/MBS invoice schema, field by field?**

Rules applied (from `Task List.md` T6):

- Collect the official NRS/NITDA guideline and provider sandbox docs. The user
  confirmed **public official sources only** (no private documents supplied yet).
- **Do not invent schema details.** Unknown fields stay unknown.
- Do **not** call NRS, a provider, or any sandbox. This is desk research.
- Output: for each real field — does the canonical model have it, does the
  validator check it, and what rejection codes are known.

## 2. Confidence tags

| Tag | Meaning |
| --- | --- |
| **[Official NRS]** | Stated on the NRS developer portal, `community.nrsmbs.com` (the official support portal for taxpayers, APPs and SIs). |
| **[Provider doc]** | A *certified* provider's public API reference. Describes its own NRS-facing payload; close to the NRS UBL fields but is **not** the NRS schema itself and may diverge. |
| **[In-repo]** | Verifiable in this repository (file + line). |
| **[Secondary]** | News/analysis article. Unverified. |
| **UNKNOWN** | No public source located. Do not assume. |

## 3. Sources used

**Official NRS developer portal (`community.nrsmbs.com`):**

- `/kb/faqs` — format is **UBL 2.1**; IRN assigned on validation; invoices are
  cryptographically stamped (CSID). **[Official NRS]**
- `/kb/standards-adopted` — UBL, WCO HS Code (goods classification), ISO 20022,
  GDPR/NDPA, ISO 27001, ISO/IEC 27002, ICD. **[Official NRS]**
- `/kb/role-of-si` and `/kb/role-of-app` — **System Integrator** maps ERP data to
  UBL, applies the CSID, registers devices for digital certificates;
  **Access Point Provider** validates, transmits, manages the Authentication
  Seal, checks required fields and TINs. **[Official NRS]**
- `/kb/process-flow` — 6 steps: taxpayer enablement → ERP integration → device
  registration (digital certificate) → APP validation and transmission → NRS
  stamping → delivery. **[Official NRS]**
- `/kb/api-authentication` — **OAuth 2.0** bearer tokens + **TLS 1.2+**;
  cryptographic signing with the taxpayer's keys; sandbox vs production
  credentials explicitly mentioned. **[Official NRS]**
- `/kb/encryption-digital-signing` — CSID = digital signature over the invoice;
  origin authentication, integrity, non-repudiation. **[Official NRS]**
- `/kb/qr-code-generation` — QR = **IRN + timestamp encrypted with the
  taxpayer's cryptographic key**; validated by the MBS 360 mobile app.
  **[Official NRS]**
- `/kb/clearance-reporting` and `/kb/b2b-vs-b2c` — **B2C = reporting model,
  within 24 hours**; **B2B = clearance model, real-time**. **[Official NRS]**
- `/kb/invoice-schema` and `/kb/tax-vs-simplified-invoice` — **redirect to
  external API documentation** (not directly retrievable without sign-in).
  **[Official NRS]**

**Certified provider public docs (third-party, used only to approximate the
field list):**

- Etranzact NRS e-Invoicing service, `developers.etranzactng.com`. Sandbox base
  URL `https://firseinvoicedemo.etranzactng.com`. Webhook-free request/response
  REST API; auth via `X-API-Key` + `X-API-Signature` (HMAC-SHA256 over
  body+timestamp) + `X-API-Timestamp`. Endpoints: `/api/v3/si/generate-irn`,
  `/api/v3/si/validate`, generate-qr-code, and APP-side `validate-irn`.
  **[Provider doc]**

**Not obtained (still needed):**

- The **NITDA National Regulatory Guideline for Electronic Invoicing in
  Nigeria, 2025** (named in `SPEC.md §2` as "Likely"; text never read).
- The **NRS MBS user guide** and the **official Invoice Schema Reference**
  (the portal redirects it to external, sign-in-gated API docs).
- Any provider's **sandbox contract** beyond Etranzact's public page.

## 4. The three questions T6 asks

### 4.1 Where did the canonical model's fields come from?

**From the app's own existing invoice snapshot — not from the NRS schema.**
Explicitly recorded in `prompts/einv-wp10.md` ("the canonical mapper consumes
that verified record and does no additional client-ID lookup. It must preserve
available values and avoid fabricating unknown data") and in the code comment on
`toCanonicalInvoice` (`src/features/einvoicing/canonical-invoice.ts:177`).
`SPEC.md D1` asked for a model "independent of any one country or provider", so
the fields mirror what Velure already stores (seller/buyer identity, lines,
tax/withholding, totals) rather than any authority's field list.

The "around 55 mandatory fields" figure in the T6 hypothesis is **not in this
repository** (searched `docs`, `src`, `prompts`) and is attributed to a vendor
blog. It cannot be confirmed against an official count; the official schema is
**UBL 2.1** and its full field list was not publicly retrievable. Treat the
count as **UNKNOWN**.

### 4.2 Why provider-agnostic rather than one provider's payload?

Because `SPEC.md D1`/`D2` made it an explicit product goal: a canonical model
plus a swappable adapter so "a provider or country can be swapped without
touching the invoice code", and `SPEC.md §7` frames multi-country expansion as
"an adapter plus a rules pack, not a rewrite". **No country/provider adapter
other than the mock exists yet.** The canonical model is therefore a
forward-looking abstraction, not a validated integration with any authority.

### 4.3 Why 10-digit TIN rules?

**Not from official guidance — from a UI hint, and the code says so.**
`src/features/compliance/supplier-profile.ts:6-15` documents that the exact
Nigerian TIN structure/checksum is "explicitly unconfirmed in SPEC 6.2 item 4;
we accept the 10-digit shape the UI hints at and reject obvious placeholder
values." The checksum is a stubbed `TODO(tin-checksum)` that returns `true`
for every 10-digit, non-placeholder string. `SPEC.md §6.2 item 4` says "10
digits is what the UI hints at; **confirm the current format and any checksum**".

> Note: the Etranzact sample uses a **dashed** TIN (`TIN-0099990001`,
> `45678901-0003`), unlike Velure's `^\d{10}$`. This is a real inconsistency to
> raise with a provider/NRS; see §9. It may be provider formatting, not the NRS
> rule — do not assume either way.

> **Decision (2026-10-30):** because the required format is unconfirmed and a
> strict block risks turning away valid customers, the TIN check is being changed
> from **block** to **warn** until NRS confirms the rule. See §10 item 3.

## 5. Field-by-field gap

Legend for **Canonical?**: ✅ present / ◐ partial / ❌ absent.
**Validator?**: whether `validateCanonicalInvoice` checks it (`src/features/einvoicing/validate-canonical-invoice.ts`).
LGA / HS / tax-category codes are values, so "present" means the model carries a
slot for the value.

Rows are keyed by the **provider's published field names** (Etranzact), which is
the closest public proxy for the NRS UBL fields — it is **not** the NRS schema.
The NRS schema itself was not retrievable (see §3).

### 5.1 Envelope

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `business_id` | ❌ | — (provider/workspace registration identity, not invoice data) | No | UNKNOWN |
| `irn` | ❌ | — (assigned after clearance; `C4` says store immutably, not in this model) | No | UNKNOWN |
| `issue_date` | ✅ | `issueDate` | Yes — `issue_date_invalid` | UNKNOWN (HTTP 400 only) |
| `due_date` | ✅ | `dueDate` | Yes — `due_date_invalid`, `due_date_before_issue` | UNKNOWN |
| `issue_time` | ❌ | — (date-only) | No | UNKNOWN |
| `invoice_type_code` (UN/CEFACT) | ◐ | `documentType` (internal enum, no numeric code) | Yes — `document_type_not_submittable` for proforma | UNKNOWN |
| `invoice_kind` (B2C/B2B/B2G) | ❌ | — (buyer type lives outside the invoice; validator takes it as trusted context) | Yes — `buyer_type_unverified` if absent | UNKNOWN |
| `payment_status` (REJECTED/PENDING/PAID) | ❌ | — | No | UNKNOWN |
| `note` | ❌ | — | No | UNKNOWN |
| `tax_point_date` | ❌ | — | No | UNKNOWN |
| `document_currency_code` | ✅ | `currency` | Yes — `currency_invalid` (ISO-4217 3-letter) | UNKNOWN |
| `tax_currency_code` | ❌ | — (single currency only) | No | UNKNOWN |
| `accounting_cost` | ❌ | — | No | UNKNOWN |
| `buyer_reference` | ❌ | — | No | UNKNOWN |
| `invoice_delivery_period` (start/end) | ❌ | — | No | UNKNOWN |
| `order_reference` | ❌ | — | No | UNKNOWN |
| `billing/dispatch/receipt/originator/contract/additional_document_reference` (IRN + issue_date) | ◐ | `relatedDocuments[].{relation:"corrects", documentId}` — internal id only, one relation type, no issue_date | Yes — `correction_source_required` (credit/debit only) | UNKNOWN |

### 5.2 Supplier party (`accounting_supplier_party`)

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `party_name` | ✅ | `seller.legalName` (or `tradingName`) | Yes — `party_name_required` | UNKNOWN |
| `tin` | ✅ | `seller.identifiers[]` scheme `tax-id` | Yes — `tin_required` / `tin_format` / `tin_placeholder` (NG only) | UNKNOWN |
| `email` | ✅ | `seller.email` | **No** (not required by validator) | UNKNOWN |
| `telephone` | ✅ | `seller.phone` | No | UNKNOWN |
| `business_description` | ❌ | — | No | UNKNOWN |
| `postal_address.street_name` | ◐ | `seller.address` (single free-text string) | Yes — `party_address_required` (non-empty only) | UNKNOWN |
| `.city_name` | ❌ | — (inside free-text) | No | UNKNOWN |
| `.postal_zone` | ❌ | — (inside free-text) | No | UNKNOWN |
| `.lga` (LGA **code**) | ❌ | — (no structured slot; provider publishes an LGA code resource) | No | UNKNOWN |
| `.state` (state **code**) | ❌ | — (no structured slot) | No | UNKNOWN |
| `.country` (country **code**) | ◐ | `seller.jurisdiction.value` (`source.jurisdictionCode`) | Yes — `party_jurisdiction_required` | UNKNOWN |

### 5.3 Customer party (`accounting_customer_party`) and other parties

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `accounting_customer_party` (whole object) | ✅ | `buyer` | Yes — name/address/jurisdiction always; TIN only when trusted `buyerType === "b2b"` | UNKNOWN |
| `accounting_customer_party` optional for B2C | ◐ | Model always expects a buyer; validator needs `buyerType` context to relax buyer TIN | Yes — `buyer_type_unverified` | UNKNOWN |
| `payee_party` | ❌ | — | No | UNKNOWN |
| `bill_party` | ❌ | — | No | UNKNOWN |
| `ship_party` | ❌ | — | No | UNKNOWN |
| `tax_representative_party` | ❌ | — | No | UNKNOWN |
| `actual_delivery_date` | ❌ | — | No | UNKNOWN |

### 5.4 Invoice lines

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `item.name` | ◐ | `lines[].description` (one field serves name *and* description) | Yes — `line_description_required` | UNKNOWN |
| `item.description` | ◐ | shares `lines[].description` | same as above | UNKNOWN |
| `item.sellers_item_identification` | ❌ | — (no product SKU on the line) | No | UNKNOWN |
| `hsn_code` (WCO HS) | ◐ | `lines[].classification` (`source.classificationCode`) — a generic code slot, provenance unverified | Yes — `classification_required` (non-empty) | UNKNOWN |
| `product_category` | ❌ | — | No | UNKNOWN |
| `discount_rate` / `discount_amount` | ◐ | line `discount` + totals `discount` / `discountMode` | Yes — per-mode `discount_*` checks; **updated 2026-10-30**, see §10 item 6 | UNKNOWN |
| `fee_rate` / `fee_amount` | ❌ | — | No | UNKNOWN |
| `invoiced_quantity` | ✅ | `lines[].quantity` | Yes — `quantity_invalid` (must be > 0) | UNKNOWN |
| `line_extension_amount` | ◐ | derived from price×qty; no stored field | Yes — via `subtotal_mismatch` | UNKNOWN |
| `price.price_amount` | ✅ | `lines[].unitPrice` | Yes — `unit_price_invalid` | UNKNOWN |
| `price.base_quantity` | ❌ | — (implicit 1) | No | UNKNOWN |
| `price.price_unit` (quantity code, e.g. `A35`) | ◐ | `lines[].unit` (free text) | Yes — `unit_required` (non-empty only) | UNKNOWN |

### 5.5 Payment terms

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `payment_means[]` (`payment_means_code` + `payment_due_date`) | ❌ | — (payment details are free text in the app; `SPEC.md B4`) | No | UNKNOWN |
| `payment_terms_note` | ❌ | — | No | UNKNOWN |
| `allowance_charge[]` (`charge_indicator` + `amount`) | ❌ | — (no allowance/charge lines) | No (discount blocked instead) | UNKNOWN |

### 5.6 Tax

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `tax_total[].tax_amount` | ✅ | `totals.taxTotal` + `taxes[].amount` | Yes — `tax_total_mismatch`, `tax_amount_invalid` | UNKNOWN |
| `tax_subtotal[].taxable_amount` | ❌ | — (no stored taxable base; computed internally) | ◐ via arithmetic, no field | UNKNOWN |
| `tax_subtotal[].tax_amount` | ✅ | `taxes[].amount` | Yes — `tax_total_mismatch` | UNKNOWN |
| `tax_category.id` (resource code, e.g. `LOCAL_SALES_TAX`) | ◐ | `taxes[].label` / `lines[].taxCategory` (`standard`\|`zero_rated`\|`exempt`) — internal names, **not** NRS category codes | Yes — `vat_category_invalid`, `tax_treatment_invalid` | UNKNOWN |
| `tax_category.percent` | ✅ | `taxContext.rate` / `taxes[].rate` | Yes — `tax_rate_invalid` | UNKNOWN |

### 5.7 Totals (`legal_monetary_total`)

| Provider-published field | Canonical? | Canonical field | Validator? | Known rejection code |
| --- | --- | --- | --- | --- |
| `line_extension_amount` | ◐ | `totals.subtotal` | Yes — `subtotal_mismatch` | UNKNOWN |
| `tax_exclusive_amount` | ◐ | `totals.subtotal` (+ implied) | Yes — `gross_total_mismatch` | UNKNOWN |
| `tax_inclusive_amount` | ✅ | `totals.grossTotal` | Yes — `gross_total_mismatch` | UNKNOWN |
| `payable_amount` | ✅ | `totals.payableTotal` | Yes — `payable_total_mismatch` | UNKNOWN |
| (withholding — no direct NRS field in the provider sample) | ✅ extra | `withholding`, `totals.withholdingTotal` | Yes — `withholding_invalid`, `withholding_total_mismatch` | UNKNOWN |

### 5.8 Aggregate

- **Envelope:** 3 of 17 fields present (`issue_date`, `due_date`,
  `document_currency_code`); the rest absent or partial.
- **Parties:** core identity present; **structured postal address
  (street/city/postal_zone/LGA/state/country codes) largely absent** — this is
  the single largest concrete gap, and it is a *hard* requirement on the
  provider sample (all six postal fields marked "Yes"). The structured
  components **already exist upstream** — supplier and buyer profiles store
  `{ street, lga, state, countryCode }` and `composeSupplierAddress` flattens
  them to one string before the canonical map (`party-identity.ts`,
  `supplier-profile.ts`) — so this is a **mapper/model gap, not missing
  collection**.
- **Lines:** basic fields present; **name vs description, product category,
  allowance/charge, and HS/quantity codes are absent or generic**.
- **Tax:** totals and rates present; **NRS tax-category *codes* and the taxable
  base are absent**.
- **Numbers are approximate** because the official schema was not retrievable;
  the provider sample is the closest public proxy.

## 6. Known rejection codes

**Officially published:** only **HTTP status codes** (200, 201, 400, 401, 403,
404) on the provider's "Response Codes" page. **[Provider doc]** No field-level
rejection catalogue is public on the NRS portal or the provider docs retrieved.

**In this repository:** `src/features/einvoicing/rejection-guidance.ts` maps
codes such as `BUYER_TIN_INVALID`, `SUPPLIER_TIN_INVALID`,
`LINE_CLASSIFICATION_MISSING`, `TOTAL_MISMATCH`, `LOCAL_VALIDATION_FAILED`,
`IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `MOCK_REJECTION` to
plain-language fixes. **These are Velure-invented mock codes, not real NRS or
provider codes.** (`IDEMPOTENCY_KEY_*` are Velure's own queue semantics; the
`MOCK_REJECTION` code is from the mock adapter.) The local validator codes
(`tin_required`, `currency_invalid`, `subtotal_mismatch`, …) are likewise
Velure's own pre-submission checks.

**Consequence:** the real code catalogue is **UNKNOWN** and must come from the
NITDA guideline, the NRS API docs, or a provider contract before D5
("provider rejection codes mapped to plain-language fixes") can be truthful.

**Action (2026-10-30):** the guidance map and the mock adapter are being changed
so every Velure-invented code carries a `MOCK_` prefix (e.g.
`MOCK_BUYER_TIN_INVALID`), so no invented code can be mistaken for a real NRS or
provider code. See §10 item 4.

## 7. What is UNKNOWN and blocks a truthful D5/D8

1. The official **NRS Invoice Schema Reference** field list (the portal redirect
   is sign-in gated).
2. The **NITDA guideline** text (schema, required fields, certificate/CSID
   handling, rejection codes).
3. The real **rejection-code catalogue** and field-level error format.
4. Whether third-party apps may integrate via a certified provider's API, and on
   what commercial terms (`SPEC.md §8` lists this as unconfirmed).
5. Whether the TIN is `^\d{10}$` or a dashed format (provider sample shows
   dashed; Velure assumes digits).
6. Any **B2G** specifics (mentioned as an `invoice_kind`) beyond the sample.

## 8. T7 — accredited providers / APPs / SIs

> **All names below are [Secondary] and unverified.** The authoritative list is
> the official register at
> `https://einvoice.firs.gov.ng/serivce-providers/accesspoint-providers/register`
> — which is JavaScript-rendered and could not be retrieved as data. Do not
> treat this as the register.

- **New Telegraph, Aug 2025 [Secondary]:** 16 NITDA-certified firms —
  Interswitch, Remita, Pasca, Hoptool, Etranzact, Telepac Africa, Cryptware,
  Namiri, Ace of Spedes, Jureb, Qucoon, Courteville, Softrust, Westmetro, Elara
  Technical, Arca Payments.
- **Pillarcraft [Secondary]:** reported accredited as an SI (Jan 2026).
- **A LinkedIn analysis [Secondary]** claims the official register carried 61
  approved providers as of 21 Jul 2026 (60 SI, 37 APP). Unverified.
- **Sandbox availability [verified in this session]:** only **Etranzact**
  publishes a public sandbox base URL and API reference
  (`firseinvoicedemo.etranzactng.com`). For every other provider, sandbox
  availability is **UNKNOWN**.
- **Roles are two-layer [Official NRS]:** the **SI** integrates the ERP, maps
  data to UBL, applies the CSID and registers the device; the **APP** validates
  and transmits to NRS and manages the Authentication Seal. A provider may hold
  both accreditations.

## 9. T7 — question list for providers and NRS/NITDA

Hand this to the user; **no one has been contacted**, and there are no known
cost/provider/timeline constraints yet.

> **★ Ask first, and get it in writing: Q4 (accreditation) and Q2 (TIN format).**
> **Do not build a real adapter until Q4 is answered in writing** — the risk is
> building an adapter Velure is not permitted to operate. The SI role (map to
> UBL, apply the CSID, register devices) is exactly what a Velure→provider
> integration would rely on someone doing, so "can we be a plain client?"
> is load-bearing, not a later detail.

**Working answers from the user [Likely, 2026-10-30] where they can be given:**

- **Q9 (auth):** both are true at different layers — OAuth 2.0 is the NRS-facing
  side, the provider's API key + HMAC is the provider-facing side. Velure would
  use the provider's scheme, not NRS's.
- **Q10 (party of record):** the **taxpayer**. The process flow starts with
  enabling each taxpayer and registering their device, which implies
  per-customer onboarding that hurts self-serve — ask providers how they handle
  onboarding at volume.
- **Q15 (data protection):** the NRS standards list names the NDPA, so expect a
  provider DPA.

**To the NRS / NITDA:**

1. Where is the official **Invoice Schema Reference** (UBL 2.1) for MBS, and is
   it available without sign-in? Can we get the NITDA guideline PDF directly?
2. ★ What is the **TIN format** required in `accounting_supplier_party.tin` /
   `accounting_customer_party.tin` — plain 10 digits or a dashed/alphanumeric
   form (the provider sample shows a dashed form)? Is there a checksum? (Velure
   currently assumes `^\d{10}$` and is relaxing it to a warning.)
3. Is the published **field-level rejection code** list available, or only HTTP
   statuses? How are errors returned per field?
4. ★ Does a **software vendor** that only calls a certified provider's API need
   its own NITDA/NRS accreditation, or is calling an accredited provider's API
   sufficient? (SI vs APP vs "just a customer of a provider".) **Get this in
   writing before building an adapter.**
5. Is a **sandbox/test environment** mandatory before production, and does it
   require registration of the taxpayer device / a test certificate?
6. Are B2G invoices different, and are there **simplified-invoice** rules for
   small taxpayers we should model?
7. What are the **onboarding and certificate** requirements per taxpayer (device
   registration, cryptographic key/CSID issuance), and who holds the keys —
   the taxpayer, the SI, or both?

**To each provider (SI/APP):**

8. Do you expose a **developer API** for third-party apps (not just a portal)?
   Can we integrate on behalf of many customers (multi-tenant), or is it one
   account per taxpayer?
9. Is there a **public sandbox**? What credentials/registration does it need,
   and what is the auth model (the NRS portal says OAuth 2.0; Etranzact uses
   API key + HMAC signature — which applies)?
10. As a Velure customer's supplier, **who is the accredited party of record** —
    the customer, or us — and what documents do we sign?
11. **Pricing and volume terms**: per-invoice cost, platform/minimum fees, and
    tiers; what happens at higher volumes.
12. **Throughput and SLA**: rate limits, retry/idempotency semantics, and how
    duplicates and timeouts are handled.
13. **Rejection model**: full code list, per-field errors, and whether a
    pre-submission `validate` call exists (Etranzact offers one).
14. **Multi-currency and withholding (WHT)**: do you accept foreign-currency
    invoices, and **does your `payable_amount` subtract WHT?** The provider
    sample has no WHT field, so if NRS's payable ignores WHT, Velure's
    withholding-adjusted `payableTotal` will disagree with theirs — confirm
    which figure is submitted as `payable_amount`.
15. **Data protection**: where is invoice data stored/processed, and what NDPA
    terms and DPA do you require?

## 10. Recommended next actions

Priority order after the 2026-10-30 review:

1. ★ **Answer Q4 (accreditation) in writing before building any real adapter.**
   Do not build an adapter Velure may not be permitted to operate.
2. **Fix the structured-address mapper** — the data already exists upstream
   (street/LGA/state/country) and is flattened to one string; confirm and fix
   this **first** among the model gaps, then `invoice_kind`, HS/product codes,
   allowance/charge, and NRS tax-category codes.
3. **Relax the TIN check from block to warn** until NRS confirms the format
   (decision above; a strict block risks rejecting valid customers).
4. **Prefix invented rejection codes with `MOCK_`** so none can be mistaken for a
   real NRS/provider code.
5. Obtain the official NRS/NITDA schema + rejection-code catalogue (blocks §7).
6. **Discount (resolved 2026-10-30):** the validator no longer blocks every
   non-zero discount. It supports three **mutually exclusive** modes —
   invoice-level before tax, invoice-level after tax, and line-level — with
   mode-aware arithmetic and specific `discount_*` / `gross_total_mismatch`
   codes. See `docs/DECISIONS.md` (Q-G) and
   `prompts/discount-money-path-2026-10.md`. The real NRS/UBL allowance/charge
   mapping is still **UNKNOWN** and must be confirmed with a provider.
7. Only after 1–6: build a real adapter against one provider's sandbox, still
   claiming **no** NRS compliance until a real invoice clears.

## 11. Checks

- Docs-only change; no code, schema, route, or migration touched.
- `pnpm test`, `pnpm typecheck`, `pnpm check` run; see the task prompt for results.
