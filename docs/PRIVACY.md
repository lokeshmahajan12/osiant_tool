# Privacy Model

SENTINEL is designed around a strict data-minimization principle: collect only
what a legitimate public API returns and what the investigator is authorized to
access, and store as little as possible.

## Data minimization

- **No credentials or private content.** Passwords, password hashes, tokens,
  OTPs, private messages, private profile content, and bank/card data are never
  requested, stored, or displayed.
- **Breach data is filtered.** HIBP results retain breach *names*, *dates*,
  and *status flags* only. Breach contents and password data are dropped.
- **Location is coarse.** IP and phone results keep only the region/city level
  returned by the provider and are explicitly labeled as approximate. No live
  GPS, no subscriber addresses.
- **Personal vCard fields** (postal addresses, personal emails) inside RDAP
  entities are filtered out before storage.

## Storage

- Investigations store a normalized input and a filtered snapshot of provider
  results as JSON. Raw API payloads are never persisted.
- Each investigation has an `expiresAt` derived from the user's retention
  setting (default 90 days). Expired records can be purged (manually or
  automatically).
- Users can delete a single investigation or their entire history. Admins can
  remove any investigation.

## Boundaries enforced in code

- The `lib/summary.ts` and `lib/report.ts` layers only ever surface the
  filtered `ProviderResult.data` objects.
- The frontend `ResultCard` hides any key matching
  `password|token|secret|api[_-]?key|authorization` from rendered output.
- Audit logs record actions and metadata (IP, user agent) but never request
  bodies containing secrets.
