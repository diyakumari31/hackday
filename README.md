# BasItna — "Proof, Not Data."

Privacy-preserving identity verification layer for Pakistani CNIC workflows. Organizations get a
temporary, audience-bound **proof** ("Identity Verified" / "18+ Verified") instead of a CNIC number or scan.

## Run locally

```bash
npm install
cp .env.example .env      # then fill BASITNA_HMAC_SECRET (+ DATABASE_URL for PostgreSQL)
npm run dev               # http://localhost:3000
npm test                  # unit & integration tests
npm run lint              # type-check
```

- No `DATABASE_URL` → in-memory demo store (the UI header says so). With `DATABASE_URL` the schema is created automatically in PostgreSQL.
- No `BASITNA_HMAC_SECRET` in development → a random ephemeral secret is generated. **In production the server refuses to start without it.**

## Production checklist
`NODE_ENV=production`, `BASITNA_HMAC_SECRET` (>= 32 chars), `DATABASE_URL`, `ADMIN_API_KEY`, run behind HTTPS (HTTP is redirected, HSTS is sent), `npm run build && npm start`.

## Key Features
- **OTP-Gated Citizen Issuance & Wallet**: 6-digit single-use OTP (5 min TTL, max 3 attempts, HMAC-hashed at rest; demo SMS banner in dev mode only).
- **My Activity Wallet (`5. My Activity`)**: Timeline of issued/redeemed/expired/revoked tokens, organization grouping, suspicious-activity red alert cards (`FLAGGED`), and one-click token revocation.
- **Live SSE Activity Feed**: Real-time updates (`GET /api/events`) across Citizen Activity and Organization Portal windows.
- **Pairwise Org-Scoped Subject IDs**: Prevents cross-organization tracking while enabling duplicate-applicant detection within a single organization.
- **Organization Stats Dashboard**: Non-PII per-organization metrics (redeemed, rejected, flagged, by purpose, last 10 events).
- **Form Privacy Analyzer (Before / After)**: Detects sensitive CNIC/DOB/location fields (excluding email/web/IP addresses from location PII) and previews a minimized BasItna form with projected privacy score.
- **QR Tokens, Retention Controls & Privacy Receipts**: Inline SVG QR codes, selectable TTL (15 min / 1 h / 24 h), and downloadable/printable HTML privacy receipts.

## How it matches the proposal
| Proposal | Implementation |
|---|---|
| HMAC-SHA256 with key outside DB | `src/utils/crypto.ts` + `src/utils/config.ts` (env only, derived sub-keys) |
| Token bound to one org + one purpose, single use, limited validity | Org/purpose/expiry in token, HMAC signature, atomic single-use, TTL capped at 24h server-side |
| Org states purpose, gets only that proof | Organizations are authenticated (`x-org-key`) and must send a purpose; orgs can only request their `allowedPurposes` |
| Pairwise unlinkable subject IDs | `deriveSubjectId(identityHmac, orgId)` returns 16-char org-scoped pseudonymous ID on verify |
| Mock NADRA behind one function | `verifyWithNadra(cnic)` — small dummy registry, unknown CNICs rejected |
| PostgreSQL | `PgStore` in `src/db/database.ts` |
| Privacy Score + sensitive-data detection | `src/utils/formAnalyzer.ts` (`detectSensitiveCategory`, local heuristic + Gemini) |
| Stores HMAC + token records only | Schema has no CNIC/DOB/image columns; the "raw CNICs stored" counter is measured by scanning stored data |

## API
| Method & Path | Purpose | Auth / Notes |
|---|---|---|
| `GET /api/health` | Store mode & measured `rawCnicStored` count | Public |
| `GET /api/organizations` | List relying organizations & allowed purposes | Public (`demoApiKey` in demo mode only) |
| `GET /api/events` | Server-Sent Events stream for live token lifecycle updates | Public (zero PII emitted) |
| `POST /api/otp/request` | Request 6-digit OTP `{ cnic }` (5m TTL, 3 attempts, HMAC-stored) | Rate limited; `demoOtp` in demo mode only |
| `POST /api/tokens/issue` | Issue proof token `{ cnic, otp, organizationId?, purpose, category, ttlHours? }` | Requires valid OTP; TTL clamped `1m..24h` |
| `POST /api/tokens/verify` | Verify/redeem `{ token, organizationId, purpose }`; returns pairwise `subjectId`; logs `FLAGGED` on mismatch/replay | Header `x-org-key` |
| `POST /api/citizen/activity` | Citizen wallet timeline, org summary & `FLAGGED` alerts `{ cnic, otp }` | Requires valid OTP (or `walletSession`) |
| `POST /api/tokens/revoke` | Revoke an `ACTIVE` token `{ token \| tokenId, cnic, otp }` | Requires valid OTP (or `walletSession`) |
| `GET /api/organizations/:id/stats` | Per-org non-PII stats & last 10 events | Header `x-org-key` |
| `POST /api/analyze-form` | Analyze form PII risk & return Before/After minimized suggestion | Rate limited; Gemini or local fallback |
| `GET /api/tokens/list`, `/api/audit-logs`, `/api/database/dump`, `POST /api/reset` | Inspection & reset endpoints | `x-admin-key` (or demo mode) |
