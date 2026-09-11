Repository:

https://github.com/Ayoola1o/email-scraper

The previous HUNTIQ security/integration implementation is substantially complete.

Do NOT redesign the application.

Do NOT add new features.

Perform only this final hardening pass before HUNTIQ integration.

### 1. Require HUNTIQ API key

Update `HuntIQConfigManager.isConfigured()`.

HUNTIQ is configured only when:

- HUNTIQ_INTEGRATION_ENABLED=true
- HUNTIQ_API_URL exists
- HUNTIQ_API_KEY exists

If any are missing, return:

HUNTIQ_INTEGRATION_NOT_CONFIGURED

Do not expose which secret is missing to the frontend.

### 2. Use one authentication mechanism

Review `huntiqClient.ts`.

Prefer:

Authorization: Bearer <HUNTIQ_API_KEY>

Do not send the same secret simultaneously as:

Authorization
and
x-huntiq-api-key

unless the HUNTIQ API contract explicitly requires both.

Do not log either header.

### 3. Validate every batch URL

The `/api/scrape/batch` endpoint must validate every submitted URL using the same SSRF validation used by the single-page and crawl endpoints.

For each URL:

1. Parse URL.
2. Allow only HTTP/HTTPS.
3. Resolve DNS.
4. Reject private/local/link-local/metadata addresses.
5. Reject invalid IP addresses.
6. Reject unsafe redirects.
7. Enforce response-size limits.
8. Enforce timeout.

Return a per-URL error when one URL is rejected.

Do not allow one unsafe URL to compromise the batch operation.

### 4. Harden IPv4 validation

In `src/utils/security.ts`, make IPv4 validation strict.

Every octet must be:

0–255.

Reject malformed addresses such as:

999.999.999.999

Do not treat malformed IP strings as ordinary hostnames.

Continue blocking:

127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
100.64.0.0/10
IPv6 loopback
IPv6 link-local
IPv6 ULA
cloud metadata addresses

### 5. Keep SSRF protection on redirects

Do not replace the existing manual redirect behavior.

Every redirect destination must be validated again before fetching it.

Maximum redirects must remain enforced.

### 6. Keep response-size protection

Do not remove streaming response-size checks.

Ensure the scraper cannot allocate unlimited memory from a malicious response.

### 7. Preserve crawler behavior

Do not change:

- email extraction behavior
- folder functionality
- CLI
- export formats
- MX verification
- quarantine functionality
- SSE
- pagination
- existing scraper UI

unless necessary for the security fixes above.

### 8. Verify quarantine behavior

Confirm:

verify email
→ persist quarantine
→ confirm success
→ remove/archive active record

If quarantine persistence fails, the original record must remain available.

### 9. Ephemeral jobs

Keep the current `activeJobs` Map for SSE/runtime behavior.

Do not implement a new database/job queue in this task.

However:

- document that job state is ephemeral
- do not claim it is durable
- do not make HUNTIQ depend on the Map surviving a server restart

### 10. Search for regressions

Search the entire repository for:

ws-default-001
ws-main
user-default
HUNTIQ_WORKSPACE_ID
createOutreachDraft
huntiqApiUrl
huntiqApiKey
localStorage.*huntiq
x-workspace-id

The HUNTIQ integration must not use any of these insecure patterns.

### 11. Test the complete security contract

Add/update tests for:

- missing HUNTIQ API key
- missing HUNTIQ URL
- disabled HUNTIQ integration
- successful configuration
- client-supplied API key ignored/rejected
- client-supplied workspace ignored/rejected
- client-supplied HUNTIQ URL ignored/rejected
- successful HUNTIQ sync
- idempotency
- retry on 5xx
- no retry on 401
- no retry on 403
- batch SSRF validation
- localhost blocked
- 127.0.0.1 blocked
- 10.x blocked
- 172.16.x blocked
- 192.168.x blocked
- 169.254.x blocked
- malformed IPv4 blocked
- metadata hostname blocked
- unsafe redirect blocked
- oversized response blocked
- quarantine failure preserves original record

### 12. Build verification

Run:

npm test
npm run build

Also run:

npm run lint

if available.

Fix all failures.

Then inspect the final git diff.

Do not modify HUNTIQ.

Do not add outreach functionality.

Do not add CRM scoring.

Do not add company enrichment.

The goal is simply:

EMAIL SCRAPER = secure, reliable discovery service ready to connect to HUNTIQ.