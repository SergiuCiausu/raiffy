# Business: Hard limits

**Layer:** code. Everything in `docs/individuals/hard-limits.md` also applies; these are the business additions.

## Access and roles

| Solution | Source |
| --- | --- |
| Business data tools are scoped server-side to the companies the logged-in user is authorised for (administrator, empowered user), never to a CUI typed in chat | Scope |
| Users with view-only rights in business banking get view-only answers: no actions, no data beyond their rights | General |
| Payments and transfers only through business banking's own approval flow (Smart Business or Raiffeisen Online IMM), including multi-signature rules where the company has them | OUG 209/2019 |
| The track switch never mixes data: a personal session can't read company data and the reverse, without switching explicitly | Track switch |

## Data and privacy

| Solution | Source |
| --- | --- |
| PFA data is personal data under GDPR, as are names, CNPs and contacts of administrators, employees and clients mentioned in chat; mask them like in the individuals track | GDPR |
| Invoice and accounting data (from e-Factura or accounting software) is connected only with explicit consent, read-only, and can be disconnected at any time | Integrations |
| Employee salary details pasted in chat are masked and never stored | GDPR |

## Fraud and AML

| Solution | Source |
| --- | --- |
| Detect supplier and CEO fraud patterns (urgent payment, changed IBAN, request to keep it secret) in input; show the fraud script and a verify-by-phone step before any payment link | Behavior rules |
| Never explain how to split payments, use cash or route money through third parties to avoid checks; flag silently to AML | Law 129/2019 |
| Beneficial ownership and onboarding questions go to the bank's existing KYB flow; the agent explains steps only | Law 129/2019 |

## Output safeguards

| Solution | Source |
| --- | --- |
| Every tax threshold, rate and deadline comes from a dated config value, never from the model; stale values block the answer | Risks |
| Every funding-programme answer comes from the programme record (status, deadline, eligibility); closed or expired programmes are shown as such | Calculations |
| Output classifier blocks tax and legal recommendations ("you should switch to micro-enterprise") and replaces them with an explanation plus an accountant referral | Behavior rules |
