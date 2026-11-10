# SENTINEL — Authorized OSINT Investigation Platform

A professional, production-oriented **defensive OSINT** web application for
authorized cybersecurity investigations. React + TypeScript + Tailwind frontend,
Node/Express + TypeScript API, PostgreSQL + Prisma, JWT + RBAC, Docker.

> **Authorization boundary.** Use this application only for systems, accounts,
> domains, and data that you own or are explicitly authorized to investigate.
> SENTINEL collects only publicly available metadata returned by legitimate
> APIs. It never accesses passwords, tokens, private messages, live locations,
> or data behind authentication. See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Features

- **Investigation dashboard** for Email, Phone, Username, Domain and IP inputs
- SOC-style dark dashboard with stats, exposure alerts and API health
- **Provider abstraction** (`OSINTProvider`) — independent enable/disable,
  timeout, retries with exponential backoff, per-provider rate limiting,
  graceful degradation when an API fails or quota is exceeded
- Real, keyless providers: **DNS**, **RDAP**, **security-header HTTP probe**
- Keyed providers: **Have I Been Pwned**, **Hunter**, **Abstract API**,
  **AbuseIPDB**, **ipinfo**, **VirusTotal**, **Shodan** (all optional)
- Deterministic **mock providers** so the app runs end-to-end with zero keys
- Breach exposure status — breach *names/dates only*, never contents
- JWT auth with server-side revocable sessions, bcrypt hashing, RBAC
  (`ANALYST` / `INVESTIGATOR` / `ADMIN`)
- Audit logging, data retention, delete single / delete all history
- **Consent-gated live location sharing** — device share page requires explicit
  browser permission + an audited consent record before any GPS fix is stored
- Live dashboard with a **LIVE → STALE → OFFLINE presence ladder** (real-time
  `device:*` / `session:*` WebSocket events), session auto-expiry, server-side
  retention sweeper, and a device-owned "delete my history" control
- Export **JSON**, **CSV** and **PDF report** (print-to-PDF, Markdown)
- Docker Compose (PostgreSQL + API + Nginx-served frontend)

## Tech stack

| Layer    | Stack                                                          |
| -------- | -------------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router         |
| Backend  | Node.js, Express, TypeScript, Zod, Helmet, CORS, rate limiting |
| Database | PostgreSQL, Prisma ORM                                          |
| Auth     | JWT (HS256) + revocable sessions, bcrypt, RBAC                 |
| Testing  | Vitest (unit + integration + security)                         |
| Deploy   | Docker, Docker Compose, environment variables                  |

---

## Quick start

Prerequisites: Node.js ≥ 18.18 (npm workspaces) and Docker Desktop (or a local
PostgreSQL instance).

### 1. Configuration

```bash
cp .env.example .env
```

Edit `.env` — at minimum set:

```dotenv
JWT_SECRET=openssl-rand-hex-32
ADMIN_PASSWORD=a-strong-bootstrap-password
DATABASE_URL=postgresql://osint:osint@localhost:5432/osint?schema=public
```

All provider keys are optional. Without them, providers run in **mock mode** so
the app is fully functional for development.

### 2. Full stack with Docker (recommended)

```bash
docker compose up --build
```

Open http://localhost:5173 and sign in with the seeded `ADMIN_EMAIL` /
`ADMIN_PASSWORD`.

### 3. Local development

Terminal 1 — database (only needed the first time):

```bash
docker compose up db
```

Terminal 2 — API + web:

```bash
npm install
npm run db:migrate   # applies prisma migrations
npm run db:seed      # creates admin + demo users
npm run dev          # starts API (:4000) and Vite (:5173) together
```

Demo users (when `DEMO_ENABLED=true`):

| Email                        | Password   | Role          |
| ---------------------------- | ---------- | ------------- |
| admin@sentinel.local         | from .env  | ADMIN         |
| analyst@sentinel.local       | demo1234   | ANALYST       |
| investigator@sentinel.local  | demo1234   | INVESTIGATOR  |

## Available commands

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `npm install`       | Install all workspace dependencies                |
| `npm run dev`       | Run API + web in watch mode                       |
| `npm run build`     | Build backend and frontend                        |
| `npm run start`     | Start the built API (`dist/`)                     |
| `npm run test`      | Run backend + frontend test suites                |
| `npm run typecheck` | Type-check both workspaces                        |
| `npm run db:migrate`| Apply Prisma migrations                           |
| `npm run db:seed`   | Seed admin + demo users                           |

## API overview

| Method | Endpoint                        | Auth  | Purpose                        |
| ------ | ------------------------------- | ----- | ------------------------------ |
| POST   | `/api/auth/login`               | –     | Login, returns JWT             |
| GET    | `/api/auth/me`                  | Bearer| Current user                   |
| POST   | `/api/auth/logout`              | Bearer| Revoke session                 |
| PATCH  | `/api/auth/me/password`         | Bearer| Change password                |
| POST   | `/api/investigations`           | Bearer| Start investigation            |
| GET    | `/api/investigations`           | Bearer| List (type/status filters)     |
| GET    | `/api/investigations/:id`       | Bearer| Poll result                    |
| DELETE | `/api/investigations/:id`       | Bearer| Delete one                     |
| DELETE | `/api/investigations`           | Bearer| Delete all own history         |
| GET    | `/api/investigations/:id/export`| Bearer| JSON or `?format=csv`          |
| GET    | `/api/investigations/:id/report`| Bearer| Report JSON or `?format=markdown` |
| GET    | `/api/providers`                | Bearer| Provider list + health         |
| POST   | `/api/providers/:name/toggle`   | INV+ | Enable/disable provider        |
| GET    | `/api/health`                   | Bearer| API health / provider status   |
| GET    | `/api/audit`                    | Bearer| Audit log (own or all as ADMIN)|
| GET    | `/api/admin/users`              | ADMIN| User management                |

## Project structure

```
├── backend/
│   ├── prisma/            schema, migrations, seed
│   └── src/
│       ├── config/        zod-validated env
│       ├── controllers/   request handlers
│       ├── lib/           logger, httpClient, rate limiter, report/export
│       ├── middleware/    auth (JWT/RBAC), audit, security, errors
│       ├── providers/     abstraction + dns/rdap/http/hibp/hunter/abstract/
│       │                  abuseipdb/ipinfo/virustotal/shodan/social + mock
│       ├── routes/        REST routing
│       ├── services/      auth, investigations, settings
│       └── utils/         input validation, confidence
├── frontend/
│   └── src/
│       ├── api/           typed API client + token handling
│       ├── components/    layout, result cards, provider health, UI kit
│       ├── context/       auth + toast
│       ├── lib/           export helpers
│       ├── pages/         login/dashboard/investigate/detail/history/
│       │                  providers/settings/audit-log
│       └── types/         shared DTO types
├── docs/                  architecture & security model
├── docker-compose.yml
└── .env.example
```

## Provider API keys

Configured only in `.env` (never in the frontend):

| Variable           | Provider    | Used for                  |
| ------------------ | ----------- | ------------------------- |
| `HIBP_API_KEY`     | HIBP        | Breach exposure (v3)      |
| `HUNTER_API_KEY`   | Hunter      | Email verification        |
| `ABSTRACT_API_KEY` | Abstract    | Email + phone validation  |
| `ABUSEIPDB_API_KEY`| AbuseIPDB   | IP abuse reputation       |
| `IPINFO_API_KEY`   | ipinfo      | IP / ASN metadata         |
| `VIRUSTOTAL_API_KEY`| VirusTotal | Domain/IP vendor verdicts |
| `SHODAN_API_KEY`   | Shodan      | Open ports / host info    |

`MOCK_MODE=true` (default) forces all keyed providers to return deterministic
synthetic data. Set `MOCK_MODE=false` and add keys to go live.

## Testing

```bash
npm run test:backend   # unit + integration (+ security payload tests)
npm run test:frontend  # component + API client tests
```

Covered cases: invalid email/phone/IP/domain, API timeout, quota exceeded,
unauthorized access, RBAC, rate limiting, SQL-injection payloads, XSS payloads,
authentication failures, secret redaction in reports, and mock-provider health.

Integration tests run against a real PostgreSQL (Docker). They skip
automatically when the database is unreachable.

## License / ethics

This project is provided for **authorized defensive security work**. Operators
are responsible for ensuring they have permission to investigate every target.
The platform deliberately excludes any capability to collect private data,
credentials, or live locations, and redacts sensitive fields from reports.
