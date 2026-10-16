# Velure: Nigeria E-Invoicing (NRS / MBS) — Problems, Risks, Law, Solutions

_Written 2026-10-16. Based on the app walkthrough video (Invoices, Reports, Products, Compliance, Payment reminders, Recurring billing, General) plus web research. Confidence tags: **[Certain]** = seen in the video or confirmed by multiple sources; **[Likely]** = strong inference or single-source; **[Guess]** = filling gaps, verify before acting._

---

## 1. Bottom line

1. **Velure is a normal invoicing app today, not an e-invoicing system.** Nothing in the video shows an Invoice Reference Number (IRN), a QR code, a clearance step with the NRS, or a connection to the Merchant Buyer Solution (MBS). **[Certain]**
2. **The Compliance page says "Informational only … not to file taxes directly." That disclaimer is correct.** But the landing page, the nav ("Compliance", "Security") and the headline "tax lines" copy suggest more than the product does. **[Certain]**
3. **You do not need to be certified to start.** The realistic path is to integrate with an NRS-certified provider and clear invoices through their API, and to stop short of claiming compliance until that works. **[Likely]** Whether a provider offers an API on terms you can afford is **unverified [Guess]**.
4. **The timing favours you.** Medium taxpayers are already mandated; small taxpayers (your likely core customers) go live July 2027. That is a 9-month window to be ready, not a deadline you have missed. **[Likely]**

---

## 2. The law and rules that apply

| Instrument | What it does for you | Confidence |
|---|---|---|
| **Nigeria Tax Act 2025** and **Nigeria Tax Administration Act 2025 (NTAA)** | In force from 1 Jan 2026. The NTAA gives the NRS the power to require taxpayers to use its "fiscalisation" technology and sets penalties for non-compliance. | Certain (effective date and NTAA power are in multiple sources) |
| **Nigeria Revenue Service (Establishment) Act 2025** | Replaced FIRS with the NRS. All references to "FIRS" in your UI, copy and exports should become "NRS". | Certain |
| **NRS E-Invoicing / Electronic Fiscal System (EFS), via the Merchant Buyer Solution (MBS)** | Invoices are submitted to the MBS for real-time validation and receive an Invoice Reference Number before the buyer sees them. | Certain |
| **NITDA National Regulatory Guideline for Electronic Invoicing in Nigeria, 2025** | Technical and regulatory guidance for e-invoicing providers and systems. | Likely (named in one source; I did not read the text) |
| **VAT at 7.5%** | Rate used in your Compliance VAT summary. Check that line-level VAT, exempt supplies and zero-rated supplies (some of which changed under the 2025 reforms) are handled. | Likely |
| **Withholding tax (WHT) rules** | WHT is deducted by the payer. Your Compliance page shows a "WHT deductions" card (₦0.00 in the video). | Likely on existence; **Guess** on exact current rates and regulation name, so confirm with an accountant |
| **Nigeria Data Protection Act 2023 (NDPA)** | You will hold customer names, emails, TINs and bank details for many businesses. You are a data processor for them and likely a controller for your own users. | Certain that it applies |
| **Foreign suppliers** | Foreign VAT-registered suppliers into Nigeria are in scope of the mandate. Matters only if you go international. | Likely |

### Rollout timeline (by annual turnover)

| Group | Turnover | Go-live | Enforcement |
|---|---|---|---|
| Large | ≥ ₦5bn | Nov 2025 (originally Aug 2025) | Apr–Jun 2026 |
| Medium | ₦1bn – ₦5bn | **1 Jul 2026** | **Jan–Mar 2027** |
| Small / emerging | < ₦1bn | **1 Jul 2027** (pilot Apr–Jun 2027) | 2028; full adoption targeted by Jan 2028 |

- Sources agree on the tiers. They disagree on small details (one article cites a "31 July" large-taxpayer deadline; others give 1 Nov 2025). Treat dates as **Likely** and confirm on the NRS notice before putting any date in marketing.
- The NRS's post-go-live review runs Oct–Nov 2026, which is **now**. Rules or formats may still change. **[Likely]**
- How businesses connect: portal (manual, low volume), or API/ERP integration through an **NRS-certified provider**. **[Likely]**

---

## 3. Problems visible in the app (from the video)

### 3.1 Gaps against the e-invoicing requirement

| # | Observation | Why it matters | Confidence |
|---|---|---|---|
| P1 | No IRN, QR code, or MBS status on any invoice. Statuses are only Draft / Sent / Paid / Overdue / Canceled. | A valid invoice for in-scope taxpayers must be cleared first. Your "Sent" invoice would not be valid for them. | Certain |
| P2 | **"Next invoice number" is editable** (set to 104), and numbering is prefix- or business-name-based (`FR35NOINC-2026-0104`). | Cleared invoices cannot be silently renumbered, deleted or reused. Editable counters invite duplicates and gaps. | Certain |
| P3 | **Invoices can exist with no customer** ("No customer yet"). Reports shows "Unknown customer" at 51% of billing. | Cleared invoices need buyer details (name, TIN for B2B). A buyer-less invoice cannot be submitted. | Certain |
| P4 | **Buyer TIN is not shown anywhere.** The Clients list shows names only; the **business** TIN sits in General. | B2B e-invoices need buyer identification. | Likely (I did not see a Client edit form) |
| P5 | **Products have an optional "Default tax ID" and no VAT category, service/goods code or unit-of-measure standard.** | Structured e-invoice data needs a tax category per line. | Certain on the fields I saw |
| P6 | **TIN field accepts placeholder-looking values** (`1234567890`) and **CAC RC number is optional** ("Not set"). Business address is free text. | Registration details must be accurate and verified; wrong supplier data gets invoices rejected. | Certain |
| P7 | **Identity mismatch:** workspace name "Fr35No Inc." vs registered business name "Velure Workspace". | Supplier name on the invoice must match registration records. | Certain (probably test data) |
| P8 | **Payment details are one free-text box.** | Fine for PDFs, but not structured payment data. | Certain |
| P9 | **Compliance exports are labelled "Tax summary … ready"**, with no submission log, retries, or clearance receipts. | You have an export trail but no *regulator* trail. | Certain |
| P10 | **Currency selector is NGN-only in the views I saw.** | Foreign-currency invoices need a rate and NGN equivalent for VAT. | Likely |

### 3.2 Logic issues to verify (test data, so low priority)

- Reports shows **Billed ₦21.1M / Outstanding ₦21.1M / Collected ₦0** while all six invoices are Drafts. Drafts are normally not receivables. You said this is test data; **re-check with real data.** **[Certain on the display, unknown on the live app]**
- Draft invoices show **past-due dates in red**, and the reminders queue lists drafts as "54 days overdue" while the Invoices and Reports pages show Overdue as ₦0 **[Certain]**. Decide: do drafts have due dates that count?
- Reminder scan toast read "… invoices scanned, 0 reminders queued" while the Payment reminders page shows 3 overdue invoices and "Ready for scan: 0". The toast text was small in the video, so check whether the scanned count matches the 6 invoices in the workspace. **[Likely; text hard to read]**

---

## 4. Risks

### 4.1 Legal / regulatory

| Risk | Detail | Severity |
|---|---|---|
| **Customers believe Velure invoices are compliant when they are not** | If a medium taxpayer issues Velure invoices after 1 Jul 2026 without clearance, the invoice may be invalid and VAT input claims by their buyers may be challenged. They will blame the tool. | **High** |
| **Misleading marketing** | "Compliance", "Security", "tax lines" in the nav/hero, plus a "Nigerian compliance dashboard", imply regulatory coverage. | **High** |
| **Penalties fall on the taxpayer, but reputational and contractual risk falls on you** | NTAA introduced penalties for non-compliance (amounts not verified here **[Guess]**). | High |
| **Uncertified provider status** | Transmitting invoices to the MBS on a customer's behalf likely requires being, or going through, a certified provider. Doing it unofficially is a legal and technical dead end. | Medium–High **[Likely]** |
| **Rules still moving** | Post-go-live review is Oct–Nov 2026; schemas, fields or thresholds may change. | Medium |
| **Wrong tax logic** | VAT/WHT mistakes get flagged on audit. The Compliance page is "informational only", but customers will rely on it. | Medium |

### 4.2 Data and security

- **NDPA 2023:** you store buyer names, emails, TINs and bank details. You need a lawful basis, a privacy notice, breach handling and a retention policy. **[Certain that it applies; specifics need counsel]**
- **Audit trail:** tax records generally must be retained for years and be tamper-evident. Hard-deleting invoices or editing sent ones conflicts with that. **[Likely]**
- **Multi-tenant isolation:** the workspace switcher ("Fr35No Inc.") implies multiple workspaces per user. One cross-tenant leak would be fatal for a finance product. **[Likely]**
- **Reminder emails sent in a customer's name** can be spam or phishing if misconfigured (sender domain, SPF/DKIM). **[Likely]**

### 4.3 Product / business

- **Your target segment (< ₦1bn) is not mandated until July 2027**, so many will not pay for compliance yet; medium taxpayers need it now but have more options (certified providers' own portals, Zoho, ERP vendors). **[Likely]**
- **Dependence on a third-party certified provider** adds cost per invoice, an outage dependency and margin pressure on a flat monthly price. **[Likely; costs unverified]**
- **Scope:** invoicing + reminders + recurring billing + compliance + (planned) statement cleaning and cash flow is already a lot for a solo build. **[Certain]**

---

## 5. Master fix list: everything needed for a full e-invoicing system

Priority: **P0** = do before any compliance claim or paying medium-taxpayer customer. **P1** = needed for real clearance. **P2** = needed to scale or compete. Phase numbers match the roadmap in section 6.2.

### A. Trust and claims
| ID | Fix | Pri | Phase |
|---|---|---|---|
| A1 | Remove or qualify "Compliance", "Security" and "tax lines" claims on the landing page until clearance works | P0 | Now |
| A2 | Add "informational, not NRS-cleared" banner on Compliance page and every tax export | P0 | Now |
| A3 | Rename FIRS to NRS everywhere | P0 | Now |
| A4 | Publish Terms, Privacy Policy and a Data Processing Agreement template (NDPA) | P1 | Later |

### B. Invoice data model
| ID | Fix | Pri | Phase |
|---|---|---|---|
| B1 | Supplier profile: validated TIN, required CAC RC, structured address (street, LGA/state, country), no placeholder values | P0 | Now |
| B2 | Buyer record: name, TIN, address, email, B2B/B2C flag; **customer required to send** (drafts may be buyer-less) | P0 | Next |
| B3 | Line items: description, quantity, unit of measure, unit price, discount, **VAT category** (standard/zero-rated/exempt), goods-or-service code | P0 | Next |
| B4 | Structured payment means (bank, account name, number, reference) instead of one free-text box | P2 | Later |
| B5 | Currency + exchange rate + NGN equivalent on every foreign-currency invoice | P1 | Later |
| B6 | Invoice types: standard, credit note, debit note, proforma (not submitted) | P1 | Next |

### C. Numbering and immutability
| ID | Fix | Pri | Phase |
|---|---|---|---|
| C1 | Remove the editable "next invoice number" after the first issued invoice. Use a server-side, per-supplier, gap-aware sequence | P0 | Next |
| C2 | Lock invoices once Submitted/Sent. Corrections only through credit/debit notes | P0 | Next |
| C3 | Soft-cancel only. Never hard-delete an issued invoice | P0 | Next |
| C4 | Store the IRN and QR payload as immutable fields once cleared | P1 | Next |

### D. Clearance engine (the core of "full e-invoicing")
| ID | Fix | Pri | Phase |
|---|---|---|---|
| D1 | Internal **canonical invoice model**, independent of any one country or provider | P1 | Next |
| D2 | **Provider adapter interface** (`validate`, `submit`, `getStatus`, `cancel/credit`) so a provider or country can be swapped without touching the invoice code | P1 | Then |
| D3 | New lifecycle: `Draft → Ready → Submitted → Cleared / Rejected → Sent → Paid` | P1 | Next |
| D4 | Submission queue with **idempotency keys**, retries with backoff, and a dead-letter state for manual review | P1 | Then |
| D5 | Provider rejection codes mapped to plain-language fixes ("buyer TIN invalid") shown on the invoice | P1 | Then |
| D6 | Store raw request/response for every submission for audit and dispute | P1 | Then |
| D7 | Render IRN + QR code on PDF and email; PDF regenerated only after clearance | P1 | Then |
| D8 | Pre-submission validator (required fields, arithmetic, VAT category, TIN format) so most errors never reach the provider | P1 | Then |
| D9 | Outage handling: define what users can do when the provider or MBS is down (queue, notify, never mark Sent) | P1 | Then |
| D10 | Sandbox mode that points to the provider's test environment, clearly marked in the UI | P1 | Then |
| D11 | Daily reconciliation job comparing Velure's records with provider/MBS status | P2 | Later |

### E. Tax engine
| ID | Fix | Pri | Phase |
|---|---|---|---|
| E1 | Versioned tax rules with effective dates (rates and categories change) | P1 | Later |
| E2 | VAT and WHT calculation with defined rounding rules, covered by tests | P1 | Next |
| E3 | Per-line and per-invoice tax totals match the submitted payload exactly | P1 | Then |
| E4 | Tax reports (VAT summary, WHT) generated from **cleared** invoices only | P2 | Later |

### F. Buyer side and receiving
| ID | Fix | Pri | Phase |
|---|---|---|---|
| F1 | Let a user record received/purchase invoices so input VAT can be tracked | P2 | Later |
| F2 | Accept/reject or dispute flow if the MBS or provider supports it (**unverified**) | P2 | Later |

### G. Archive and audit
| ID | Fix | Pri | Phase |
|---|---|---|---|
| G1 | Append-only audit log: who created, edited, sent, cancelled, exported | P1 | Next |
| G2 | Retention policy (keep tax records for the legally required period; confirm the period with an adviser) | P1 | Later |
| G3 | Export of the full invoice archive (PDF + structured data) per tenant | P2 | Later |

### H. Security and tenancy
| ID | Fix | Pri | Phase |
|---|---|---|---|
| H1 | Tenant-isolation test suite (workspace A can never read workspace B) | P0 | Next |
| H2 | Encrypted storage of provider credentials, certificates and API keys; never in logs | P1 | Then |
| H3 | Roles (owner, accountant, viewer), MFA, session management | P1 | Later |
| H4 | Reminder email hygiene: verified sending domain, SPF/DKIM/DMARC, unsubscribe | P1 | Next |

### I. Operations
| ID | Fix | Pri | Phase |
|---|---|---|---|
| I1 | Monitoring and alerting on submission failure rate and queue age | P1 | Then |
| I2 | Status page and a documented incident process | P2 | Later |
| I3 | Backups with restore tested | P1 | Later |

### J. Integrations
| ID | Fix | Pri | Phase |
|---|---|---|---|
| J1 | Public API + webhooks (`invoice.cleared`, `invoice.rejected`) so other systems can issue invoices through Velure | P2 | Later |
| J2 | CSV import (already exists) with validation report per row | P1 | Next |
| J3 | Payments: pay links (Paystack/Flutterwave locally, Stripe or similar outside Nigeria) and automatic mark-as-paid | P1 | Later |
| J4 | Bank-statement matching to flip invoices to Paid. This is your cash-flow link and your main differentiator | P1 | Later |
| J5 | Accounting connectors (e.g., Zoho, QuickBooks, Xero) once the core is stable | P2 | Later |

---

## 6. Solutions

### 6.1 Strategy options

| Option | What | Pros | Cons | My view |
|---|---|---|---|---|
| **A. Integrate with an NRS-certified provider's API** | Velure creates the invoice, sends it to the provider, gets IRN/QR back, stores them. | Fastest route to real compliance; no certification burden. | Per-invoice cost, dependence, provider terms. | **Recommended, after you confirm a provider offers a usable API** |
| **B. Get certified yourself** | Become an access point / system provider. | Control, margin. | Slow, expensive, audit overhead. | Not for a solo, pre-revenue product |
| **C. Export-only "portal assist"** | Generate structured data the user uploads/keys into the NRS portal. | Cheap, honest, quick. | Manual; not real compliance; weak value. | Good **interim** step for small taxpayers (before 2027) |
| **D. Don't claim compliance** | Position as invoicing + reconciliation, with "e-invoicing ready" only when true. | Zero regulatory risk. | Gives up the compliance wedge. | Do this **immediately**, regardless of A–C |

### 6.2 Actions in order

**Now (this week) — remove risk**
1. Reword the landing page: drop or qualify "Compliance" and "tax lines". Add "Not an NRS-certified e-invoicing provider. Does not submit invoices to the MBS." until that is true. (D)
2. Rename FIRS references to NRS everywhere (UI, exports, copy).
3. Add a visible banner on the Compliance page and on every tax export: "Informational summary. Not a tax filing and not NRS-cleared."
4. Validate TIN format (10 digits is what the UI hints at; confirm the current format and any checksum) and require a real TIN and address for the business profile. Reject obvious placeholders.

**Next (1–2 weeks) — fix the data model so clearance is possible later**
5. **Immutable numbering:** remove the editable "next invoice number" once the first invoice is issued (or restrict to "can only go up"). Sequence must be gap-aware and unique per supplier.
6. **Issued invoices are locked.** Corrections via credit note / debit note, never edit or delete after "Sent".
7. **Require a customer before sending** (drafts can be buyer-less; sending cannot). Add buyer TIN, address and email as first-class fields on Client, with a "B2B vs B2C" flag.
8. **Line-level tax data:** VAT category (standard / zero-rated / exempt), goods-or-service code and unit of measure on Products; make them required per line.
9. Add an **invoice lifecycle** that can hold the new states: `Draft → Ready → Submitted → Cleared (IRN) / Rejected → Sent → Paid`. Store raw request/response from the provider for audit.
10. Fix the reporting logic (exclude drafts from Outstanding unless you decide otherwise).

**Then (before committing to build) — validate the integration**
11. Read the **NRS MBS user guide** and the **NITDA guideline** directly. I relied on secondary summaries, so confirm schema, required fields, certificate/stamp handling and rejection codes.
12. Shortlist 2–3 NRS-certified providers (DigiTax is named in one source). Ask each: API access for third-party apps? Sandbox? Per-invoice price? Multi-tenant (one account per Velure customer) or one master account? **Do not assume any of this.**
13. Build against a **sandbox** first. Do not go live until a medium-taxpayer pilot customer has cleared real invoices.

**Later**
14. Pricing: decide whether clearance cost is bundled in the flat monthly fee, metered, or passed through. Model at least 3 volume levels.
15. NDPA: privacy notice, DPA template for customers, breach process, data-retention policy, and register with the NDPC if you meet the threshold (check with counsel).
16. Pen-test or at least a tenant-isolation test suite before onboarding paying customers.

---

## 7. Going international

**Short answer:** yes, it is possible, and the fix list above is the foundation, but not by competing in Europe's big mandates head-on. [Likely]

### 7.1 Why the architecture matters more than the country

Every country with a mandate does the same three things: structured invoice data, a tax authority or network connection, and a proof (code, QR, stamp). The details differ. If you build the **canonical invoice model (D1)** and **provider adapter interface (D2)** once, each new country becomes an adapter plus a rules pack, not a rewrite. That is also what makes the product more sellable on a marketplace like TrustMRR than a Nigeria-only tool. [Likely]

### 7.2 The landscape (from the sources I fetched)

| Region | Systems and dates | Notes |
|---|---|---|
| **Nigeria** | NRS MBS: medium 1 Jul 2026, small 1 Jul 2027 | Home market |
| **Ghana** | GRA e-VAT, clearance model, rolled out Oct 2022 to end-2024; each invoice validated and carries an SDC code and QR code | Same pattern as Nigeria |
| **Kenya** | eTIMS, rollout completed 2024 | Mature, crowded |
| **Uganda** | EFRIS, scope expanded July 2025 | |
| **Zambia** | Smart Invoice, fully operational 2024 | |
| **Côte d'Ivoire** | FNE, mandatory from Sept 2025 | Francophone, French UI needed |
| **Burkina Faso** | Certified system for B2B and B2C from 1 Jul 2026 | |
| **Angola, Botswana, Mauritius** | Phased, mostly large taxpayers, 2026 | Early |
| **Egypt** | Clearance model since 2020, complete 2023 | |
| **UAE** | Mandate from Jul 2026 | Peppol-based **[Likely]** |
| **Belgium** | B2B from Jan 2026 | Peppol |
| **Poland** | KSeF from Feb 2026 | National system, not Peppol |
| **France** | Large companies Sep 2026, SMEs Sep 2027 | |
| **Germany** | Receiving since Jan 2025, sending Jan 2027 | |
| **EU** | ViDA cross-border reporting 2030 | |

Dates come from Cleartax (updated March 2026) and Banqup; I could not cross-check each against official sources, so **treat them as Likely** and confirm per country before building.

### 7.3 Three entry routes, ranked

| Route | What | Why | Risk |
|---|---|---|---|
| **1. Other African clearance markets (Ghana first, then Kenya/Uganda/Zambia)** | Add a country adapter and rules pack for each | Same clearance pattern as Nigeria, so your Nigeria build transfers; you know the buyer; fewer polished SME tools **[Guess]** | Each country needs its own registration, certified-provider or API access, local tax rules, and support. Check whether a local entity is required **[Likely]** |
| **2. "Send to anywhere" via Peppol for African exporters** | Nigerian/African firms that invoice EU or UAE customers: Velure produces a Peppol-compatible invoice and delivers it through a **managed access point** | Don't become an access point: that means OpenPeppol fees, twice-yearly protocol updates, monthly reporting and accreditation. A managed service is the realistic route; one vendor claims it can be live in days, though that vendor sells the service **[Likely]** | Niche may be small. Per-invoice partner cost eats margin. Buyer-side requirements vary by country |
| **3. Compete for EU domestic mandates (Poland, Belgium, France, Germany)** | Full local localisation | Biggest market | **Not recommended.** Strong incumbents (Pagero, Sovos, Avalara, Basware, Storecove-type providers), language, local legal duties. A solo builder will lose here **[Likely]** |

### 7.4 Recommended order

1. **Finish Nigeria properly** (sections 5 and 6) and get 3–5 paying medium-taxpayer customers. International expansion without a working clearance flow is just a bigger promise you can't keep.
2. **Prove the adapter model on one more country**, with Ghana as the first candidate, using a design partner there.
3. **Add Peppol output through a managed access point** for exporters.
4. **Only then** consider UAE or other Gulf/EU markets, and only through partners.

### 7.5 International readiness checklist (non-mandate items)

- Multi-currency, exchange rates, and rounding (B5)
- Payment collection outside Nigeria. **Your Dodo Payments block is still unresolved**, and this decides whether you can charge international customers at all
- Localisation: French (for francophone Africa), date and number formats, tax-label naming (VAT / GST / sales tax)
- A legal entity and bank route that can invoice and receive foreign currency
- Data residency and local privacy law per market (NDPA does not cover them)
- Support hours and language per market
- Pricing in USD for international plans, with local-currency options where it helps

### 7.6 Honest risks of going international

- **Dilution:** each new country adds compliance upkeep (rule changes, schema updates) that you carry alone. [Certain]
- **Moving targets:** several mandates changed dates in the last year. [Likely]
- **Revenue concentration:** one provider outage or one provider-policy change can break a whole country. [Likely]
- **Demand is unproven:** I have no evidence yet that SMEs in Ghana or Kenya want a new tool rather than their current provider's portal. Test with a landing page and 5 conversations before building an adapter. [Certain that this is untested]

---

## 8. Things I could not confirm (verify before relying on this)

- Exact penalty amounts under the NTAA and the specific regulation that sets the e-invoicing penalties.
- Whether third-party apps can integrate via a certified provider's API, and at what price.
- The exact invoice schema, QR/IRN format, and certificate requirements of the MBS.
- Current WHT rates and regulation names, plus VAT treatment of zero-rated/exempt items after the 2025 reforms.
- Precise small-taxpayer dates (July 2027 go-live is well sourced; enforcement dates vary by source).
- Whether the invoice, client and reminder behaviours I noted are test-data artefacts rather than real logic.
- International dates and systems (section 7.2) come from two secondary sources; the UAE/Peppol link, per-country local-entity requirements, and Peppol managed-service pricing are unverified.
- One planned source (a guide on e-invoicing for SaaS sellers) could not be fetched, so the exporter angle in 7.3 rests on general reasoning and the access-point article.

**Not legal or tax advice.** Have a Nigerian tax adviser or lawyer review the compliance claims before launch.

---

## Sources

- Fonoa — [Nigeria releases phased rollout plan for E-Invoicing](https://www.fonoa.com/resources/blog/nigeria-releases-phased-rollout-plan-for-e-invoicing)
- SNI Technology — [Nigeria Confirms Phased e-Invoicing Implementation Timeline](https://snitechnology.net/nigeria-confirms-phased-e-invoicing-implementation-timeline/)
- TechCabal — [What e-invoicing means for Nigerian businesses](https://techcabal.com/?p=185975)
- Guardian Nigeria — [NRS sets July 31 e-invoicing deadline](https://guardian.ng/?p=2886050)
- Zoho Books — [Everything you need to know about e-invoicing in Nigeria](https://www.zoho.com/books/academy/taxes-and-compliance/nigeria-einvoicing.html)
- Beancount.io — [Nigeria E-Invoicing for Medium Taxpayers](https://beancount.io/blog/2026/09/26/nigeria-e-invoicing-medium-taxpayers-nrs-mbs-guide)
- Cleartax — [Global e-invoicing mandates by country](https://www.cleartax.com/global-e-invoicing-mandates-by-country)
- Banqup — [Electronic invoicing and reporting in Africa](https://www.banqup.com/resources/blog/electronic-invoicing-and-reporting-in-africa)
- Storecove — [6 considerations for becoming a Peppol access point](https://www.storecove.com/blog/en/6-considerations-for-becoming-peppol-access-point/)