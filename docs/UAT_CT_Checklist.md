---
title: UAT Checklist - Cross-Persona Contracts (UAT-CT-*)
status: tracking
companion_to: LoadLead_CrossPersona_Contract_UAT_BDD.md
connie-publish: true
connie-page-id: '2031625'
---

# UAT-CT - manual sign-off on cross-persona contracts

The automated Pact suite (@H5..@H11) proves that the loadlead-api
provider matches every persona consumer's contract. This checklist is
the HUMAN sign-off saying "yes, the automated contract is the contract
this persona's team actually wants enforced." Different layer - both
are needed.

How to use this:
1. Open the consumer pact file for the persona you're signing off on
   (e.g. `frontend-v2/tests/contract/shipper-web.pact.test.ts` for
   UAT-CT-S).
2. Read each interaction's `uponReceiving(...)` description + the
   request/response shape.
3. Compare against what your team actually wants the API to do.
4. Fill PASS / FAIL / NEEDS-WORK below, with your initials + date.

A PASS means the persona team accepts the automated pact as the right
contract - Pact verification is then trusted as gate against that
contract. A FAIL means the automated pact diverges from what the team
actually wants; the pact needs to be revised (and the test re-run).
NEEDS-WORK means partial coverage - some interactions accepted, some
need extension.

| ID         | Linked feature | Tester | Date | Result | Notes |
|------------|----------------|--------|------|--------|-------|
| UAT-CT-S   | @H5 shipper-web    |        |      |        |       |
| UAT-CT-C   | @H6 carrier-web    |        |      |        |       |
| UAT-CT-O   | @H7 oo-web         |        |      |        |       |
| UAT-CT-D   | @H8 driver-web     |        |      |        |       |
| UAT-CT-R   | @H9 receiver-web   |        |      |        |       |
| UAT-CT-A   | @H10 admin-console |        |      |        |       |
| UAT-CT-X   | @H11 cross-persona gate |   |      |        |       |

When all 7 read PASS, the contract suite is considered ratified by the
human personas; from that point forward, the can-i-deploy gate
(`@H11`) IS the cross-persona compatibility guarantee.

A FAIL or NEEDS-WORK does NOT block the automated suite from running -
it blocks the suite from being trusted as the gate. Resolve the divergence
(update the pact, update the API, or both), then re-run UAT.
