You are working on the Email Scraper repository.

Repository:
https://github.com/Ayoola1o/email-scraper

Your task is to perform a production-hardening pass on the CURRENT codebase.

IMPORTANT:
- Do NOT rebuild the application.
- Do NOT redesign the product.
- Do NOT invent features.
- Preserve the existing scraper functionality and current UI.
- Preserve the HUNTIQ integration contract.
- Make focused security, reliability, configuration, and persistence fixes.
- Do not move CRM/business intelligence responsibilities into Email Scraper.
- Email Scraper remains a DATA ACQUISITION SERVICE.

Its responsibility is:

website/domain
    ↓
crawl
    ↓
extract email/contact evidence
    ↓
validate/filter
    ↓
return records
    ↓
optional HUNTIQ sync

HUNTIQ remains responsible for:

company resolution
CRM contacts
lead qualification
scoring
signals
opportunities
outreach
workspace/business intelligence

CURRENT CODEBASE

The latest branch already contains:

- scraper engine
- webpage scraping
- website crawling
- crawl progress
- SSE/live progress
- HUNTIQ integration
- HUNTIQ configuration UI/API
- security URL validation
- crawl limits
- export functionality
- folders/search organization
- React UI
- tests
- timeout lifecycle fixes

Do not replace these systems.

FIX THE FOLLOWING

1. PROTECT HUNTIQ CONFIGURATION ENDPOINTS

Review:

/api/integrations/huntiq/config

GET and POST configuration endpoints currently expose/manage server-side HUNTIQ configuration.

These endpoints must not be publicly writable.

Required behavior:

- Only an authenticated/authorized administrator or trusted local configuration mechanism may change HUNTIQ integration settings.
- Do not allow an unauthenticated internet user to change:
  - HUNTIQ_API_URL
  - HUNTIQ_API_KEY
  - HUNTIQ_INTEGRATION_ENABLED
  - timeout
  - retries
- GET should expose only sanitized configuration status.
- Never return the API key itself.
- Never return partial API-key characters such as the last four characters unless there is a strong existing compatibility requirement.
- Prefer:
  hasApiKey: true/false

Use the existing authentication architecture if one exists.

Do not invent a second authentication system unnecessarily.

2. STOP WRITING SECRETS TO .env FROM HTTP REQUESTS

Review:

persistEnvSettings()

and:

POST /api/integrations/huntiq/config

The current implementation writes HUNTIQ_API_KEY and other settings into .env at runtime.

Do not persist secrets by modifying .env through an HTTP request in production.

Required architecture:

Production:
- secrets/configuration should come from environment/deployment secret configuration.

Development/local:
- local .env may continue to be used manually.

The application should not assume that a runtime HTTP request can modify the deployment filesystem.

If configuration editing is retained in the UI, clearly separate:
- runtime configuration
- deployment/environment configuration

Do not tell the frontend that a secret was permanently persisted if it was only changed in process memory.

Return an accurate status.

3. FIX MASKED API KEY HANDLING

Current UI/API behavior uses a masked API key such as:

••••••••1234

and sends special handling to prevent overwriting the real key.

Simplify this.

Preferred behavior:

GET configuration:

{
  hasApiKey: true,
  apiKey: ""
}

Frontend:
- display "Configured"
- input remains empty
- optional "Replace API key" action

POST:
- empty API key means "keep existing key"
- supplied API key means "replace existing key"

Never send an existing secret back to the browser merely to display it.

Never log API keys.

4. VALIDATE HUNTIQ CONFIGURATION INPUTS

Server-side validate:

HUNTIQ_API_URL:
- valid URL
- HTTPS in production unless there is an explicit documented local-development exception
- no unsafe protocols
- no malformed values

timeout:
- sensible minimum
- sensible maximum

maxRetries:
- sensible range

enabled:
- actual boolean

API key:
- non-empty when being replaced
- do not accidentally store masked values

Return 4xx validation errors instead of generic 500 errors for invalid client input.

5. REVIEW SSRF PROTECTION

Audit:

validateSafeScrapeUrl()
sanitizeCrawlLimits()
safeFetch()

Ensure all URL-fetching paths are protected.

Check:

- http/https only
- localhost blocked
- loopback blocked
- private IP ranges blocked
- link-local ranges blocked
- metadata endpoints blocked
- DNS rebinding protections where applicable
- redirects revalidated
- redirect destination cannot escape the SSRF policy

Do not weaken the current protections.

Add regression tests for any missing cases.

6. REVIEW RESPONSE-SIZE AND BODY-STREAM LIMITS

The previous lifecycle streaming timeout fix is important.

Verify that:

- timeout starts before the complete network operation
- same AbortController covers fetch + redirect + response-body consumption
- timeout remains active while streaming the body
- timeout is cleared only after the entire operation completes
- response-body size limits cannot be bypassed through streaming
- stalled connections eventually terminate
- resources are released correctly

Do not regress the existing lifecycle timeout tests.

7. REVIEW ASYNC CRAWL JOB ARCHITECTURE

Current:

activeJobs = new Map()

This is intentionally ephemeral runtime state.

That is acceptable for live progress/SSE, but make the behavior explicit.

Required:

- activeJobs must never be treated as durable database storage.
- HUNTIQ must not depend on activeJobs surviving a server restart.
- SSE disconnect must not incorrectly cancel a crawl unless cancellation was explicitly requested.
- stale jobs must be cleaned up safely.
- completed job memory must not grow without bound.
- records held in memory should have reasonable limits.

If the existing product promises durable Job History, inspect how Job History is actually implemented and identify whether it survives restarts.

Do not invent a database unless the existing product requires durable persistence.

8. AUDIT FOLDER STORAGE

Review:

src/utils/folderStorage

Determine whether folders/records are stored:

- in memory
- filesystem
- another persistence mechanism

If the current implementation is ephemeral but the UI represents folders as persistent user data, fix the mismatch using the smallest appropriate solution.

Do NOT blindly introduce a large database architecture.

The important requirement is:

Do not falsely represent ephemeral data as durable production data.

9. HUNTIQ SYNC CONTRACT

Verify:

/api/integrations/huntiq/sync

and deprecated:

/api/sync/huntiq

Required:

- server-side HUNTIQ credentials only
- no client-controlled API credentials
- no client-controlled workspace assignment
- factual scraper records only
- no fabricated company IDs
- no opportunity scoring
- no lead qualification
- no CRM business logic

The payload should contain factual discovery information such as:

- email
- email type/category
- source URL
- page URL where available
- discovered company/domain context
- scraper job ID
- source type

HUNTIQ performs company resolution and CRM persistence.

10. AUTHENTICATION HEADER CONSISTENCY

Review HuntIQClient.

If the client currently sends both:

Authorization: Bearer ...

and

X-HUNTIQ-API-KEY: ...

determine the canonical authentication mechanism used by the current HUNTIQ API.

Prefer one canonical header.

Only retain both if backward compatibility is explicitly required.

Document the contract in code/types/tests.

11. HUNTIQ CONNECTION TEST

Review:

/api/integrations/huntiq/test

Ensure statuses are meaningful:

- not configured → 503
- authentication failure → 401
- unreachable service → appropriate 502/connection error
- successful connection → 200

Ensure:
- no secrets appear in response
- no secret appears in logs
- 4xx/5xx responses are interpreted correctly
- explicit unauthenticated responses are handled correctly

Preserve the existing fixes for:
- 500
- 404
- 401
- explicit authenticated false
- slow/stalled response body

12. API INPUT VALIDATION

Audit all public scraper endpoints:

/api/scrape/page
/api/scrape/crawl
/api/export
/api/integrations/huntiq/*
/api/folders/*

Validate:
- URL
- crawl depth
- max pages
- timeout
- delay
- arrays
- format
- folder IDs
- record payload sizes

Never trust client-provided values.

Use the existing sanitization helpers where possible.

13. CORS AND HTTP SECURITY

Review current Express configuration.

Do not leave broad CORS enabled for production unless explicitly required.

Ensure:
- production origins can be configured
- development can remain flexible
- security headers are considered
- request body limits remain enforced
- sensitive configuration endpoints are protected

Do not break the existing frontend.

14. ERROR HANDLING

Audit API error responses.

Ensure production responses do not expose:
- stack traces
- API keys
- internal filesystem paths
- environment variables
- sensitive upstream responses

Keep useful machine-readable error codes where possible.

15. TESTING

Run the complete existing test suite:

npm test

Also run:

npm run build

and the TypeScript/type-check process used by the project.

Add/update tests for:

- protected HUNTIQ config endpoint
- masked API key behavior
- no runtime .env secret persistence
- invalid HUNTIQ configuration
- SSRF cases
- redirect SSRF
- response-size limits
- stalled body timeout
- HUNTIQ 401
- HUNTIQ 404
- HUNTIQ 500
- HUNTIQ unavailable
- HUNTIQ successful connection
- sync authentication
- crawl cancellation
- job cleanup
- folder persistence behavior if applicable

Do not report success unless commands actually pass.

16. UI PRESERVATION

The current UI has already been redesigned.

Do NOT create another UI design.

Do NOT add:
- new dashboard sections
- new product modules
- speculative analytics
- new CRM features
- new AI features

Only make UI changes where necessary to correctly represent:
- configured/not configured
- saved/not saved
- API key masked state
- connection status
- validation errors
- loading state
- error state

Keep the existing visual design.

17. FINAL REVIEW

Before finishing:

- inspect git diff
- inspect changed files
- run full tests
- run build
- verify TypeScript
- verify no secret logging
- verify no runtime .env secret writes
- verify HUNTIQ config cannot be publicly modified
- verify SSRF protections remain active
- verify lifecycle timeout remains intact
- verify HUNTIQ sync still works

Do not change the HUNTIQ API contract unless absolutely necessary.

Then provide:

1. Files changed
2. Security fixes
3. HUNTIQ integration fixes
4. Scraper reliability fixes
5. Persistence findings/fixes
6. Tests executed
7. Build result
8. Remaining risks

Commit with a clear message such as:

fix: harden production configuration and scraper security