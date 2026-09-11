You are working on the GitHub repository:

https://github.com/Ayoola1o/email-scraper

I want to turn this application into the dedicated **email/contact discovery service for HUNTIQ**.

IMPORTANT:
Do not redesign the existing UI.
Do not remove the existing CLI, scraper, crawler, exports, SSE telemetry, or standalone functionality.
Do not rewrite the entire application.
Preserve existing functionality while implementing the HUNTIQ integration cleanly.

The architectural responsibility must be:

EMAIL-SCRAPER = DATA ACQUISITION

HUNTIQ = INTELLIGENCE + CRM + LEAD MANAGEMENT

The email-scraper must NOT make CRM decisions.

==================================================
1. TARGET ARCHITECTURE
==================================================

HUNTIQ will eventually request:

Company/domain
        ↓
Email Scraper
        ↓
Website crawling
        ↓
Email/contact extraction
        ↓
Evidence + provenance + confidence
        ↓
Webhook/API response
        ↓
HUNTIQ

The scraper should provide factual discovery results only.

It must NOT:
- invent company names
- invent websites
- invent job titles
- invent contact names
- create CRM leads
- assign HUNTIQ opportunity scores
- create outreach campaigns automatically
- fabricate email addresses

==================================================
2. CREATE A PROPER HUNTIQ INTEGRATION MODULE
==================================================

Create a dedicated integration layer, for example:

src/integrations/huntiq/

with appropriate files such as:

huntiqClient.ts
huntiqTypes.ts
huntiqConfig.ts
huntiqMapper.ts

Keep HUNTIQ-specific logic out of the generic scraper.

Environment configuration:

HUNTIQ_API_URL=
HUNTIQ_API_KEY=
HUNTIQ_WORKSPACE_ID=

Never expose HUNTIQ_API_KEY to the browser.

Never require the frontend to send the HUNTIQ API key.

Never hardcode:
- API keys
- workspace IDs
- localhost HUNTIQ URLs
- production credentials

If the integration is not configured, return a clear configuration error.

==================================================
3. FIX / REPLACE /api/sync/huntiq
==================================================

The current endpoint accepts:

records
huntiqApiUrl
apiKey
workspaceId
createOutreachDraft
source

This is not acceptable for production.

Do NOT trust these values from the browser.

The server configuration must determine:

HUNTIQ_API_URL
HUNTIQ_API_KEY
HUNTIQ_WORKSPACE_ID

The frontend should only submit discovered records or initiate a configured sync.

Create a secure endpoint:

POST /api/integrations/huntiq/sync

Request:

{
  "records": [...]
}

The server adds authentication when communicating with HUNTIQ.

==================================================
4. CREATE THE NEW DATA CONTRACT
==================================================

Use a versioned payload.

Example:

{
  "integration": "email-scraper",
  "version": "1.0",
  "requestId": "uuid",
  "source": {
    "type": "website_email_scraper",
    "jobId": "scrape-job-id"
  },
  "company": {
    "name": null,
    "domain": "example.com",
    "website": "https://example.com"
  },
  "contacts": [
    {
      "email": "john@example.com",
      "emailType": "personal",
      "emailStatus": "found",
      "confidence": 0.96,
      "sourceUrl": "https://example.com/team",
      "sourceType": "website",
      "name": "John Smith",
      "jobTitle": "CEO",
      "phone": null,
      "socials": {}
    }
  ]
}

The exact TypeScript interfaces should be strongly typed.

==================================================
5. DATA PROVENANCE IS REQUIRED
==================================================

Every discovered email should preserve where it came from.

For each email support:

email
sourceUrl
sourceType
confidence
emailType
emailStatus

Possible emailType:

PERSONAL
ROLE_BASED
UNKNOWN

Possible sourceType:

WEBSITE
CONTACT_PAGE
TEAM_PAGE
ABOUT_PAGE
FOOTER
RAW_TEXT
OTHER

Possible status:

FOUND
VALIDATED
UNVERIFIED

Do not claim an email is deliverable merely because it matches an email regex.

==================================================
6. NEVER FABRICATE COMPANY DATA
==================================================

REMOVE behavior like:

domain:
techcorp.io

becoming:

companyName:
Techcorp

Also remove:

website:
https://domain.com

when the scraper did not actually discover a website URL.

If the company name is not discovered:

company.name = null

If the website was not actually discovered:

company.website = null

The domain may still be preserved when it is the actual crawl domain.

HUNTIQ will perform company resolution.

==================================================
7. NEVER FABRICATE CONTACT IDENTITY
==================================================

Do NOT automatically convert:

john.smith@example.com

into:

firstName = John
lastName = Smith

unless explicitly marked as inferred.

Prefer:

{
  "email": "john.smith@example.com",
  "name": null,
  "identityInference": {
    "firstName": "John",
    "lastName": "Smith",
    "confidence": 0.45,
    "source": "email_local_part"
  }
}

If the website explicitly says:

John Smith
Chief Executive Officer

then:

{
  "name": "John Smith",
  "jobTitle": "Chief Executive Officer",
  "identitySource": "website",
  "confidence": 0.98
}

Do not mix inferred and verified data.

==================================================
8. HUNTIQ CLIENT
==================================================

Create a reusable HuntIQClient.

It should support:

syncContacts()
checkConnection()
sendWebhook()
getJobStatus() if required by the final contract

Use:

Authorization: Bearer <HUNTIQ_API_KEY>

or the authentication mechanism defined in the HUNTIQ integration contract.

Do not rely on arbitrary:

x-workspace-id

from the browser.

The workspace is determined by the configured integration credentials.

==================================================
9. CONNECTION TEST
==================================================

Create:

POST /api/integrations/huntiq/test

It should verify:

- HUNTIQ URL configured
- API key configured
- HUNTIQ reachable
- authentication accepted
- integration version supported

Return structured results:

{
  "success": true,
  "integration": "huntiq",
  "reachable": true,
  "authenticated": true
}

Never return the API key.

==================================================
10. SYNC RESPONSE
==================================================

HUNTIQ sync should return:

{
  "success": true,
  "requestId": "...",
  "accepted": 20,
  "rejected": 2,
  "duplicates": 5,
  "errors": [],
  "huntiqResponse": {}
}

Do not interpret HTTP 200 as meaning every contact became a CRM lead.

HUNTIQ is responsible for final ingestion decisions.

==================================================
11. RETRY / TIMEOUT
==================================================

Implement:

- request timeout
- controlled retries
- exponential backoff
- retry only transient failures
- no retry for authentication errors
- no retry for malformed payloads

Do not create duplicate records when a request is retried.

Use requestId/idempotency support.

Send an idempotency key such as:

Idempotency-Key: <requestId>

==================================================
12. JOB SUPPORT
==================================================

The existing crawler uses:

activeJobs = new Map()

Keep the existing SSE behavior for local/standalone use, but do not pretend this is durable production job storage.

For HUNTIQ integration, expose enough information for HUNTIQ to know:

jobId
status
startedAt
completedAt
pagesVisited
emailsFound
errors

Possible status:

QUEUED
RUNNING
COMPLETED
CANCELLED
FAILED

Do not return massive email arrays through SSE events if that can cause memory problems.

==================================================
13. SECURITY
==================================================

Audit all public scraper endpoints.

At minimum:

- validate URL
- only allow http/https
- protect against SSRF
- reject localhost
- reject loopback addresses
- reject private RFC1918 networks
- reject link-local addresses
- reject cloud metadata IPs
- validate DNS resolution
- validate redirect destinations
- set request timeout
- limit response body size
- limit crawl pages
- limit crawl depth
- limit concurrency
- rate limit public endpoints
- validate request body sizes

Do not allow the scraper to become an SSRF proxy.

The existing:

express.json({ limit: '10mb' })

must not be treated as sufficient protection.

==================================================
14. EXISTING /api/sync/huntiq COMPATIBILITY
==================================================

If the old endpoint must remain temporarily for compatibility, mark it deprecated and route it through the new integration service.

Do not keep insecure behavior merely for backward compatibility.

The old endpoint must NOT accept arbitrary:

apiKey
workspaceId
huntiqApiUrl

from an untrusted browser.

==================================================
15. REMOVE AUTOMATIC OUTREACH CREATION
==================================================

Do not send:

createOutreachDraft = true

as the default integration behavior.

The scraper should only deliver discovery data.

HUNTIQ decides:

whether the contact qualifies
whether a lead should be created
whether outreach should happen
what message should be generated

==================================================
16. TESTS
==================================================

Update the existing HUNTIQ integration tests.

Do NOT keep tests that assert fabricated behavior such as:

domain → company name

or:

email → guaranteed firstName/lastName

Add tests for:

1. Successful HUNTIQ connection
2. Authentication failure
3. Missing configuration
4. Successful contact sync
5. Invalid payload
6. Timeout
7. HUNTIQ 500 retry
8. HUNTIQ 401 no retry
9. Idempotency
10. Duplicate contacts
11. Provenance preservation
12. Inferred identity separation
13. No fabricated company name
14. No fabricated website
15. No automatic outreach
16. API key never returned to client
17. SSRF protection
18. response-size limits
19. crawl limits

==================================================
17. UPDATE README
==================================================

Document:

HUNTIQ integration architecture

Environment variables

Connection test

Sync endpoint

Payload schema

Authentication

Error codes

Retry behavior

Webhook behavior if implemented

Local development example

Production deployment example

Never put a real secret in README.

==================================================
18. QUALITY GATE
==================================================

Before finishing:

npm run build
npm test

Fix every TypeScript error.

Fix every failing test.

Review all changed files for:
- hardcoded credentials
- hardcoded workspace IDs
- unsafe defaults
- fabricated data
- exposed API keys
- SSRF vulnerabilities
- duplicate synchronization
- memory leaks

Do not claim completion unless the build and tests pass.

==================================================
FINAL ACCEPTANCE CRITERIA
==================================================

The email scraper is complete only when:

1. It can scrape emails normally.
2. It can crawl websites normally.
3. Existing standalone functionality still works.
4. HUNTIQ integration is isolated in its own module.
5. HUNTIQ credentials are server-side only.
6. No client-controlled workspace is trusted.
7. No company information is fabricated.
8. No contact identity is presented as verified when inferred.
9. Every email contains provenance where available.
10. Sync is idempotent.
11. Retries are controlled.
12. SSRF protections exist.
13. Crawl/resource limits exist.
14. HUNTIQ connection testing works.
15. Integration tests pass.
16. npm build passes.
17. npm test passes.

Do not redesign the application UI during this task.

Do not modify HUNTIQ yet.

This task is ONLY to make email-scraper a clean, secure, production-ready data acquisition service that HUNTIQ can consume.