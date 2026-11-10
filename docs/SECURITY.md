# Security & Privacy Model

## Authorization boundaries

SENTINEL only collects and displays:

- Publicly available information
- Information returned by legitimate APIs
- Information the investigator is authorized to access
- Metadata and exposure indicators

It never obtains or exposes passwords, tokens, OTPs, private messages, private
social content, bank/card data, exact home addresses, live GPS, government ID
numbers, leaked-database contents, or anything behind authentication.

Technical guards:

- **No credential attacks.** No login spraying, stuffing, or session abuse code
  exists anywhere in the codebase.
- **No private scrapers.** Providers only call documented public APIs or the
  platform's own DNS/RDAP/HTTP probes.
- **SSRF containment.** The HTTP probe provider only issues a single, short
  `HEAD` request to a validated domain (no redirects, no user-supplied URLs,
  5 s timeout). DNS resolves via Node's resolver only.
- **Breach data hygiene.** HIBP results expose breach *names*, *dates* and
  *status flags only* — never passwords, hashes, or breach contents.
- **Geolocation framing.** IP results carry the coarse region/city returned by
  the provider and are explicitly labeled as approximate network metadata, not
  physical location.

## Server hardening

| Concern        | Implementation                                            |
| -------------- | --------------------------------------------------------- |
| Headers        | Helmet (CSP, HSTS in prod, nosniff, frameguard, etc.)     |
| CORS           | Allow-list from `CORS_ORIGINS`, credentials disabled       |
| Injection      | Prisma parameterized queries; Zod schema validation        |
| XSS            | React escaping + CSP; JSON-only API responses              |
| CSRF           | Bearer-token auth over HTTPS; no cross-site cookie writes  |
| Brute force    | bcrypt cost 12 + per-IP + per-user rate limiting           |
| Secrets        | `.env` only, never logged; `JWT_SECRET` required in prod   |
| Logging        | Structured (pino); secrets/tokens/PII excluded             |

## Audit logging

Every login, logout, investigation creation, deletion, settings change and
provider toggle writes an `AuditLog` row (actor, action, IP, user agent,
timestamp). `ADMIN` can review all logs; other roles see their own.

## Data retention

- Investigations carry an `expiresAt` derived from the user's retention setting.
- Users can delete a single investigation or wipe their entire history.
- `ADMIN` can remove any investigation.
- No raw API payloads are stored — only a normalized, field-filtered snapshot.

## Roles

| Action                            | ANALYST | INVESTIGATOR | ADMIN |
| --------------------------------- | :-----: | :----------: | :---: |
| Run investigations                |   yes   |     yes      |  yes  |
| View/export own investigations    |   yes   |     yes      |  yes  |
| Delete own investigations         |   yes   |     yes      |  yes  |
| View all investigations           |   no    |     no       |  yes  |
| Toggle providers                  |   no    |     yes      |  yes  |
| View audit log (all)              |   no    |     no       |  yes  |
| Manage users                      |   no    |     no       |  yes  |
