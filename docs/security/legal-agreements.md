---
connie-title: Security - Legal Disclosures & Agreements
connie-publish: true
connie-page-id: '164006'
---

# LoadLead LLC: Legal Disclosures & Agreements

**Status:** Draft template for attorney review
**Last updated:** June 12, 2026

> **This is not legal advice and these are not finished legal documents.** They are working templates prepared to give a licensed attorney a head start. Freight marketplaces sit at the intersection of transportation regulation (FMCSA), payments/money-movement law, and consumer/commercial financing rules. Engage a qualified transportation and fintech attorney to review, complete, and localize everything below before publishing or relying on it. Bracketed text in [ALL CAPS] marks placeholders you must fill in.

---

## 0. Read This First: Regulatory Flags

These five items determine whether the agreements below are even structured correctly. Resolve them with counsel before launch.

1. **Broker authority (the big one).** If LoadLead arranges transportation between shippers and carriers for compensation, FMCSA may classify it as a freight broker. Brokers must register for broker authority (an MC number) and maintain a $75,000 surety bond (BMC-84) or trust fund. Operating as an unregistered broker carries civil penalties and exposes the company and potentially its principals to liability. The alternative structures (pure technology platform / "neutral marketplace" with no involvement in the transportation contract, or registered broker) lead to very different agreements. Decide which one LoadLead is.

2. **Payment facilitation / money transmission.** Moving shipper funds through to carriers can implicate money transmitter licensing. Using Stripe Connect with properly structured connected accounts is the common way to stay inside Stripe's licenses and money-services coverage rather than becoming a transmitter yourself. Confirm the Connect structure (and who is "merchant of record") with counsel.

3. **Factoring and commercial financing disclosures.** True factoring is a purchase of receivables, not a loan, but several states (including California and New York) now require commercial-financing disclosures. If LoadLead embeds a factor or earns referral revenue, clarify in writing that the factor, not LoadLead, is the financing provider.

4. **Insurance and cargo liability.** The platform should disclaim being the carrier or insurer, require carriers to carry and prove insurance, and avoid contract language that could make LoadLead a guarantor of carrier performance or cargo safety.

5. **Capacity tools are not compliance guarantees.** The safety-buffer and volume/weight features are planning aids. They must not be presented as guaranteeing legal weight, axle, or dimensional compliance. The carrier remains solely responsible for operating legally. This disclaimer appears in the Terms below and should stay there.

---

## 1. Document Map

| Document | Purpose | Who accepts |
|---|---|---|
| Terms of Service | Master agreement governing platform use | All users |
| Privacy Policy | What data is collected and how it is used | All users |
| Acceptable Use Policy | Conduct rules and prohibited activity | All users |
| Electronic Communications Consent (E-SIGN) | Consent to electronic records and signatures | All users |
| Carrier Terms (Addendum A) | Carrier-specific representations | Carrier orgs |
| Shipper Terms (Addendum B) | Shipper-specific representations | Shipper orgs |
| Payments & Factoring Disclosure (Addendum C) | Payment rails, ACH, third-party factoring | Paying/paid users |

---

## 2. Terms of Service

**LoadLead LLC, Terms of Service**
Effective date: [DATE]. Last updated: [DATE].

### 2.1 Acceptance

These Terms of Service (the "Terms") form a binding agreement between you and LoadLead LLC, a [STATE] limited liability company ("LoadLead," "we," "us"). By creating an account, accessing, or using the LoadLead application, website, or related services (collectively, the "Platform"), you agree to these Terms. If you are accepting on behalf of an organization, you represent that you have authority to bind that organization, and "you" includes that organization.

### 2.2 Eligibility

You must be at least 18 years old and able to form a binding contract. You must operate a lawful business and, where applicable, hold all licenses, registrations, and authority required to provide or arrange motor carrier transportation.

### 2.3 Nature of the Platform (Marketplace Disclaimer)

LoadLead provides a technology platform that helps shippers, receivers, and motor carriers (including owner-operators) connect, share load and equipment information, and coordinate payment. [CHOOSE ONE BASED ON COUNSEL'S BROKER ANALYSIS:]

- **[If technology-only:]** LoadLead is not a motor carrier, freight broker, freight forwarder, factor, or insurer. LoadLead does not take possession of freight, does not direct the means or manner of transportation, and is not a party to the transportation contract between shipper and carrier. Any transportation arrangement is solely between the shipper and the carrier.
- **[If registered broker:]** LoadLead operates as a licensed property broker under FMCSA authority [MC NUMBER] and arranges transportation as a broker subject to the separate Broker-Carrier Agreement.

LoadLead does not guarantee the availability, quality, legality, safety, timeliness, or outcome of any load, shipment, equipment, or user.

### 2.4 Accounts and Organizations

Users belong to organizations and hold roles (Owner, Admin, Dispatcher, Driver, Shipper User, Receiver User) as described in the Platform. You are responsible for the accuracy of your account information, for all activity under your account, and for safeguarding your credentials. Owners and Admins are responsible for the users they invite and the permissions they grant.

### 2.5 User Obligations

You agree to provide accurate equipment, load, weight, dimension, insurance, and authority information; to comply with all applicable laws and regulations, including FMCSA, DOT, and state highway rules; and not to misuse the Platform. Carriers are solely responsible for safe and legal loading, weight distribution, securement, routing, and operation of equipment.

### 2.6 Capacity, Weight, and Safety-Buffer Tools (No Compliance Guarantee)

The Platform offers volume, weight, and safety-buffer features to assist with planning. These tools rely on information you and other users provide and on simplified calculations. They do not measure actual axle weights, do not account for every legal or physical constraint, and do not guarantee compliance with any weight, axle, dimensional, or other legal limit. You remain solely responsible for verifying that any load is legal and safe before transport. LoadLead disclaims liability for fines, citations, out-of-service orders, damage, or injury arising from reliance on these tools.

### 2.7 Payments and Fees

Payment processing is provided through third parties, including Stripe, and where applicable through factoring companies. Your use of payment features is subject to Addendum C and to the third parties' own terms. LoadLead's fees are described in the Platform and may change on notice. You authorize LoadLead and its payment partners to charge and disburse funds as described.

### 2.8 Factoring

Factoring services, if offered through the Platform, are provided by independent third-party factoring companies, not by LoadLead. LoadLead does not advance funds, make credit decisions, or provide financial advice. Where a carrier's factor has issued a Notice of Assignment, you authorize and direct payment routing consistent with that assignment.

### 2.9 Intellectual Property

LoadLead and its licensors own all rights in the Platform, including software, design, and trademarks. We grant you a limited, revocable, non-exclusive, non-transferable license to use the Platform for its intended business purpose. You retain rights in the content and data you submit and grant LoadLead a license to use it to operate and improve the Platform.

### 2.10 Suspension and Termination

We may suspend or terminate access for violation of these Terms, suspected fraud, legal risk, or non-payment. You may stop using the Platform at any time. Sections that by their nature should survive termination (including disclaimers, limitations of liability, indemnification, and dispute resolution) survive.

### 2.11 Disclaimers of Warranty

THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. LOADLEAD DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT ANY MATCH, USER, OR TRANSACTION WILL MEET YOUR EXPECTATIONS.

### 2.12 Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, LOADLEAD AND ITS OWNERS, OFFICERS, AND AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST REVENUE, CARGO LOSS OR DAMAGE, FINES, OR LOSS OF DATA, ARISING FROM OR RELATED TO THE PLATFORM. LOADLEAD'S TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE GREATER OF [AMOUNT, e.g. $100] OR THE FEES YOU PAID TO LOADLEAD IN THE [NUMBER]-MONTH PERIOD BEFORE THE CLAIM. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO PARTS OF THIS SECTION MAY NOT APPLY TO YOU.

### 2.13 Indemnification

You agree to indemnify and hold harmless LoadLead from claims, damages, and expenses (including reasonable attorneys' fees) arising from your use of the Platform, your loads or shipments, your operation of equipment, your breach of these Terms, or your violation of law or the rights of any third party.

### 2.14 Dispute Resolution and Arbitration

[ARBITRATION CLAUSES ARE JURISDICTION-SENSITIVE; HAVE COUNSEL DRAFT.] The parties agree to first attempt to resolve disputes informally. Any unresolved dispute will be resolved by binding arbitration administered by [ARBITRATION BODY] under its rules, on an individual basis. You and LoadLead waive the right to a jury trial and to participate in a class action, to the extent permitted by law. [INCLUDE OPT-OUT MECHANISM IF REQUIRED.]

### 2.15 Governing Law

These Terms are governed by the laws of the State of [STATE], without regard to conflict-of-laws principles, except where federal transportation law applies.

### 2.16 Changes to the Terms

We may update these Terms. Material changes will be communicated through the Platform or by email. Continued use after the effective date of changes constitutes acceptance.

### 2.17 Contact

LoadLead LLC, [ADDRESS]. [EMAIL]. [PHONE].

---

## 3. Privacy Policy

**LoadLead LLC, Privacy Policy**
Effective date: [DATE].

### 3.1 Scope

This Policy explains how LoadLead LLC collects, uses, shares, and protects information when you use the Platform.

### 3.2 Information We Collect

- **Account and organization data:** name, business name, email, phone, role, and business identifiers.
- **Operational data:** equipment details, capacity and dimensions, loads, shipments, facility profiles, and load history.
- **Payment data:** processed by Stripe and, where applicable, factoring partners. LoadLead does not store full bank or card numbers; payment partners handle that data under their own policies.
- **Verification data:** authority, insurance, and identity information you or partners provide.
- **Usage and device data:** log data, device identifiers, and cookies or similar technologies.

### 3.3 How We Use Information

To provide and operate the Platform, match loads and equipment, process payments, verify users, prevent fraud, comply with law, communicate with you, and improve the service.

### 3.4 How We Share Information

- With other users as needed to coordinate loads (for example, sharing relevant load or contact details between a matched shipper and carrier).
- With service providers such as Stripe (payments), factoring partners, hosting, and analytics, under contract.
- For legal reasons, to comply with law, enforce our Terms, or protect rights and safety.
- In a business transfer such as a merger or acquisition.

We do not sell personal information for money. [IF ANY SHARING COULD BE "SALE" OR "SHARING" UNDER STATE LAW, DISCLOSE AND PROVIDE OPT-OUT.]

### 3.5 Data Retention

We retain information as long as needed to provide the Platform, comply with legal and tax obligations, resolve disputes, and enforce agreements.

### 3.6 Your Rights

Depending on your location (for example, under the CCPA/CPRA or other state laws), you may have rights to access, correct, delete, or port your information, and to opt out of certain sharing. To exercise rights, contact [PRIVACY EMAIL]. We will verify and respond as required by law.

### 3.7 Security

We use reasonable administrative, technical, and physical safeguards. No method of transmission or storage is perfectly secure, and we cannot guarantee absolute security.

### 3.8 Children

The Platform is for business use and is not directed to children under 18. We do not knowingly collect data from children.

### 3.9 Changes and Contact

We may update this Policy and will post the new effective date. Contact: LoadLead LLC, [ADDRESS], [PRIVACY EMAIL].

---

## 4. Acceptable Use Policy

You agree not to:

1. Provide false, misleading, or fraudulent information, including inaccurate weights, dimensions, authority, or insurance details.
2. Use the Platform without the licenses, authority, or insurance required by law.
3. Circumvent the Platform to avoid fees after a match is made, where prohibited by your agreement.
4. Harass, defraud, or harm other users.
5. Upload malware, scrape data without permission, probe security, or interfere with Platform operation.
6. Use the Platform for any illegal purpose, including transporting prohibited goods or violating sanctions, hazardous-materials, or safety laws.
7. Misuse another user's data obtained through the Platform beyond coordinating the relevant load.

Violations may result in suspension, termination, and reporting to authorities where appropriate.

---

## 5. Electronic Communications Consent (E-SIGN)

By using the Platform, you consent to receive agreements, disclosures, notices, and other records electronically, and you agree that electronic signatures, acceptances, and records are legally equivalent to handwritten signatures and paper records. You may withdraw consent by [METHOD], understanding that this may prevent use of the Platform. You are responsible for keeping a valid email address on file and for the hardware and software needed to access electronic records.

---

## 6. Addendum A: Carrier Terms

By using the Platform as a carrier, you represent and agree that:

1. You hold and will maintain all motor carrier authority, registrations, and permits required for the freight you haul.
2. You carry and will maintain auto liability, cargo, and any other legally required insurance at or above [LIMITS], and will provide proof on request.
3. You are solely responsible for legal and safe loading, weight and axle compliance, securement, routing, hours-of-service, and operation. Platform capacity tools do not relieve you of this responsibility.
4. You will honor any Notice of Assignment from your factoring company and authorize payment routing accordingly.
5. You are an independent business. Nothing creates an employment, agency, partnership, or joint-venture relationship with LoadLead.
6. You will not accept a load that exceeds your equipment's legal or safe capacity.

---

## 7. Addendum B: Shipper Terms

By using the Platform as a shipper, you represent and agree that:

1. You will accurately describe each load, including weight, dimensions, commodity, special handling, and any hazardous-materials status.
2. You are authorized to tender the freight and to authorize payment for it.
3. You will pay valid invoices in accordance with the Platform's payment terms, including authorizing ACH debit where you elect it.
4. You understand LoadLead is [a technology platform / a broker, per Section 2.3] and is not the carrier, and that the transportation is performed by the matched carrier.
5. You will not tender unlawful, undeclared hazardous, or prohibited freight.

---

## 8. Addendum C: Payments & Factoring Disclosure

1. **Processor.** Payment processing is provided by Stripe and is subject to the Stripe Connected Account Agreement and Stripe's terms. By using payment features, you agree to those terms and authorize the creation of a connected account where applicable.
2. **ACH authorization.** Where you elect ACH, you authorize LoadLead and its processor to initiate debit and credit entries to the designated account, and you represent you are authorized to permit those entries. You may revoke authorization as provided by [METHOD], subject to transactions already initiated.
3. **Fees.** Platform and processing fees are disclosed in the Platform and may be deducted from disbursements.
4. **Factoring is third-party.** Any factoring is provided by an independent factoring company, not by LoadLead. LoadLead does not lend, advance its own funds, make credit decisions, or provide financial, tax, or legal advice. The factor's terms, fees, and recourse provisions govern that relationship.
5. **Notice of Assignment.** Where a carrier factors, payment will be routed to the factor of record consistent with the Notice of Assignment. Paying parties acknowledge this routing.
6. **No financial advice.** Information in the Platform about payment timing, factoring, or fees is for convenience only and is not financial advice.

---

## 9. Suggested Placement and Acceptance Flow

- Present the Terms of Service, Privacy Policy, and E-SIGN consent at signup with an unchecked "I agree" control and dated, logged acceptance per user (consistent with the audit-logging approach used elsewhere in the platform).
- Surface the Carrier or Shipper Addendum during the relevant onboarding step based on the organization's capability flags.
- Present the Payments & Factoring Disclosure when a user first sets up payouts or elects factoring.
- Keep version history of each document and re-prompt for acceptance on material changes.

---

## 10. Open Items for Counsel

1. Confirm broker vs. technology-platform classification and, if broker, add a Broker-Carrier Agreement and reflect bond/authority.
2. Finalize the arbitration and class-action-waiver language for enforceability in target states.
3. Complete state-specific privacy disclosures and any "sale/share" opt-out.
4. Confirm money-movement structure and merchant-of-record treatment with the payment processor.
5. Add commercial-financing disclosures if required by any state where factoring is offered.
6. Set insurance minimums and verification requirements for carriers.
7. Confirm entity details, governing law, venue, and notice addresses.
