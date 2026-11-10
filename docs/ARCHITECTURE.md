# Architecture

SENTINEL is an authorized, defensive OSINT investigation platform. It collects
only public metadata and legitimate-API responses, stores minimal data, and
never attempts to access private content, credentials, or live locations.

## System overview

```
┌────────────────────────────────────────────────────────────┐
│  Browser (React + TS + Tailwind, dark SOC UI)              │
│  /login /dashboard /investigate /investigation/:id         │
│  /history /providers /settings /audit-log                  │
└───────────────────────────────┬────────────────────────────┘
                                │ HTTPS (JWT Bearer, CSRF-safe JSON)
┌───────────────────────────────▼────────────────────────────┐
│  API (Express + TS)                                        │
│  Helmet · CORS · rate limiting · Zod validation · audit    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Provider registry (OSINTProvider interface)        │    │
│  │ dns · rdap · http · hibp · hunter · abstract       │    │
│  │ abuseipdb · ipinfo · virustotal · shodan · mock    │    │
│  │ timeout · retry/backoff · per-provider rate limit  │    │
│  └────────────────────────────────────────────────────┘    │
└───────────────────────────────┬────────────────────────────┘
                                │ Prisma ORM
┌───────────────────────────────▼────────────────────────────┐
│  PostgreSQL  (users, investigations, audit_logs, settings) │
└────────────────────────────────────────────────────────────┘
```

## Monorepo layout

```
├── backend/                 Express API
│   ├── prisma/              schema + migrations + seed
│   └── src/
│       ├── config/          zod-validated environment
│       ├── controllers/     request handlers
│       ├── lib/             logger, http client, rate limiter, report/export
│       ├── middleware/      auth, audit, error handler, security
│       ├── providers/       OSINT provider abstraction + implementations
│       ├── routes/          REST route definitions
│       ├── services/        business logic (auth, investigations, settings)
│       ├── utils/           input validation, confidence, normalization
│       └── index.ts         bootstrap
├── frontend/                React SPA (Vite)
│   └── src/
│       ├── api/             typed API client
│       ├── components/      layout + reusable UI
│       ├── context/         auth + toast state
│       ├── lib/             export/report helpers
│       ├── pages/           route pages
│       └── types/           shared DTO types
└── docker-compose.yml       api + web + postgres
```

## Data flow for an investigation

1. Client POSTs `{ type, value }` to `/api/investigations`.
2. Input is validated + normalized (`utils/input.ts`). Example: an email is
   lowercased, an IP is canonicalized, a domain is IDNA-encoded.
3. A `PENDING` investigation row is created and an audit log entry is written.
4. The orchestration service runs all enabled providers that `support(type)`
   concurrently with `Promise.allSettled` so one failure never blocks the rest.
5. Each provider returns a `ProviderResult` (source, status, confidence,
   timestamp, data). Failures are stored as `ERROR`/`RATE_LIMITED` results.
6. An aggregate confidence is computed from successful provider confidences.
7. The row is updated to `COMPLETED` (or `PARTIAL` if every provider failed).
8. The client polls `GET /api/investigations/:id` and renders result cards.

## Provider abstraction

```ts
interface OSINTProvider {
  name: string;
  category: ProviderCategory;
  supports: InputType[];
  enabled(env: Env): boolean;
  investigate(input: InvestigationInput): Promise<ProviderResult>;
}
```

- Providers are independent modules under `src/providers/<name>/`.
- Each provider has a **mock implementation** used when the related API key is
  missing or when `MOCK_MODE=true`, so the app runs end-to-end with no keys.
- Network calls go through `lib/httpClient.ts` (timeout + exponential-backoff
  retry + status classification). DNS uses Node's `dns.promises`.
- Provider results are stored as JSON on the investigation; the raw response is
  filtered by each provider so no sensitive fields are persisted.

## Security model

- Passwords hashed with bcrypt (`BCRYPT_ROUNDS=12`).
- JWT access tokens (`HS256`, short expiry) verified in `middleware/auth.ts`.
- RBAC: `ADMIN > INVESTIGATOR > ANALYST`. Users may read/delete only their own
  investigations unless ADMIN.
- Helmet secure headers, strict CORS allow-list, JSON-only API, Zod validation
  on every input, Prisma parameterized queries (no raw SQL).
- CSRF is mitigated by using `Authorization: Bearer` + same-origin policy and
  `SameSite`-aware cookies; no cookie-based cross-site mutation is possible.
- Audit logging for auth + destructive/administrative actions.
- No API keys in frontend bundles; keys only read server-side from `.env`.
- Rate limiting: global per-IP, plus per-user investigation quota.

See `SECURITY.md` and `PRIVACY.md` for details.
