# Individuals: Regulations (compliance processes and official sources)

**Layer:** owned by people (the team, the bank's DPO, legal and compliance), not by code. Most items are one-time setup plus periodic review. Status as of October 2026; confirm with Raiffeisen legal before production.

## Assessments and records

| Solution | Source |
| --- | --- |
| AI system record: purpose, limited-risk classification, model, owner, review date | Auth · AI Act |
| Documented AI-literacy training for everyone working on the agent | Auth · AI Act Art. 4 |
| Keep the agent out of credit scoring; reassess before adding it, at least a year before 2 December 2027 | Auth · Digital Omnibus |
| DPIA with the bank's DPO before production, citing relevant EDPB guidelines | Auth · ANSPDCP Decision 174/2018 |
| Record of processing, vendor DPAs and access logs kept audit-ready | Auth · GDPR, ANSPDCP Decision 161/2018 |
| Retention policy defined per data type | EC · Privacy |

## Vendors and resilience

| Solution | Source |
| --- | --- |
| Outsourcing register entry, risk assessment and contracts for the LLM, Convex and hosting; notify BNR when material | Auth · BNR Reg. 5/2013, EBA guidelines |
| DORA vendor register, exit plans, incident runbook and yearly resilience test | Auth · DORA |

## Reviews and sign-offs

| Solution | Source |
| --- | --- |
| Legal sign-off on the comparison template | Auth · Law 158/2008 |
| Dark-pattern and consumer-law review in the release checklist | Auth · Law 363/2007, OUG 58/2022 |
| Hardship, crisis and bereavement scripts reviewed with the vulnerable-customer team | EC · Vulnerable customers |
| Confirm with compliance that BNR's AML rules apply rather than ONPCSB's | Auth · ONPCSB Order 37/2021 |

## Official source documents

| Solution | Source |
| --- | --- |
| SECCI and standard credit forms for loans | Auth · OUG 50/2010 |
| ESIS as the mortgage catalog schema | Auth · OUG 52/2016 |
| Fee Information Documents for current accounts | Auth · Payment Accounts Directive |
| KIDs for investment products | Auth · PRIIPs |
| IPIDs for insurance products | Auth · ASF Norm 22/2021 |
| FGDB depositor form, re-ingested whenever it changes | Auth · Law 311/2015 |
| Only compare insurers listed in ASF's register | Auth · Law 237/2015 |

## Existing regulated flows the agent hands off to

| Solution | Source |
| --- | --- |
| Investment advice through the bank's MiFID flow | Auth · Law 126/2018, ASF Reg. 5/2019 |
| Insurance sales through the IDD flow | Auth · Law 236/2018 |
| Payments through the app's SCA flow | Auth · OUG 209/2019 |
| KYC and onboarding through the existing flow | Auth · BNR AML regulation |
| Complaints as tickets with SLA tracking | Auth · OG 38/2015 |
| Loan applications through Smart Mobile's official flow (SECCI, contract, 15-day reflection period, qualified e-signature) | Raiffeisen Flexicredit and Smart Mobile T&C |

## Delivery of plan summaries

| Solution | Source |
| --- | --- |
| Deliver plan summaries in the Smart Mobile Inbox and by email as a service message, which needs no marketing consent because the customer requested it | GDPR, Law 506/2004 |

## Tracking changes

| Solution | Source |
| --- | --- |
| Credit rules kept in config for the CCD2 transposition | Auth · OUG 50/2010, CCD2 |
| Internal owner tracking ANCOM guidance and the national AI Act law | Auth · AI Act national law |
| Configurable AML escalation rules ready for AMLR in July 2027 | Auth · AMLR |
| Data layer ready for consented external data under FIDA | Auth · FIDA |
| Check CSALB's legal status before citing it in the product | Auth · OG 38/2015 |
| "AI-generated" credit on the hero video | Auth · AI Act Art. 50 |
