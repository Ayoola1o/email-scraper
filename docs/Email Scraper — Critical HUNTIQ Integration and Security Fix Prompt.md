You are working on:

https://github.com/Ayoola1o/email-scraper

The application has recently added a HUNTIQ integration. Review the existing implementation carefully and FIX the integration rather than rebuilding the entire application.

IMPORTANT:

- Do not redesign the existing UI.
- Do not remove existing scraper functionality.
- Do not remove CLI functionality.
- Do not remove SSE/live crawl telemetry.
- Do not rewrite unrelated modules.
- Preserve standalone email-scraper functionality.
- Make focused, production-quality changes.

The architecture must be:

EMAIL-SCRAPER
= website crawling
= email/contact discovery
= verification
= provenance/evidence

HUNTIQ
= workspace ownership
= company resolution
= CRM
= contact management
= intelligence
= scoring
= lead qualification
= outreach

The scraper must NOT make CRM decisions.

==================================================
PHASE 1 — REMOVE CLIENT-CONTROLLED HUNTIQ CREDENTIALS
==================================================

The current implementation allows the frontend/browser to provide or store:

- HUNTIQ API key
- HUNTIQ API URL
- Workspace ID

This must be removed.

The browser must NEVER:

- store the HUNTIQ API key in localStorage
- send the HUNTIQ API key to the server
- control the HUNTIQ destination URL
- choose a HUNTIQ workspace

Remove any HUNTIQ API key persistence from:

localStorage
sessionStorage
frontend state persistence
exported configuration

The HUNTIQ integration configuration must be server-side.

Use environment variables:

HUNTIQ_API_URL=
HUNTIQ_API_KEY=
HUNTIQ_INTEGRATION_ENABLED=

Do not add a default production API URL.

Do not hardcode credentials.

If HUNTIQ integration is disabled or not configured, return a clear error:

HUNTIQ_INTEGRATION_NOT_CONFIGURED

Example:

{
  "success": false,
  "code": "HUNTIQ_INTEGRATION_NOT_CONFIGURED",
  "message": "HUNTIQ integration is not configured on this server."
}

Never return secrets to the client.

==================================================
PHASE 2 — REMOVE CLIENT-CONTROLLED WORKSPACE
==================================================

Remove all HUNTIQ integration logic that allows:

workspaceId

to be supplied by the browser and trusted by the server.

Completely remove production fallbacks such as:

ws-default-001
ws-main
default workspace
user-default-001

Search the entire repository for:

ws-default
workspaceId
x-workspace-id
HUNTIQ_WORKSPACE_ID

Fix every integration path that trusts a workspace selected by the client.

The scraper service must not decide or impersonate arbitrary HUNTIQ workspaces.

The HUNTIQ API key/integration credential will determine which HUNTIQ integration or workspace is authorized server-side.

Do not send arbitrary x-workspace-id values from the browser.

==================================================
PHASE 3 — LOCK DOWN THE HUNTIQ DESTINATION
==================================================

The browser must not be able to submit:

huntiqApiUrl

or any arbitrary destination URL.

Remove this from public request bodies.

The server should use only:

process.env.HUNTIQ_API_URL

or validated server-side configuration.

Do not allow this endpoint to become a generic HTTP proxy.

==================================================
PHASE 4 — REBUILD THE HUNTIQ SYNC CONTRACT
==================================================

Create or refactor a dedicated module:

src/integrations/huntiq/

Suggested structure:

huntiqClient.ts
huntiqConfig.ts
huntiqTypes.ts
huntiqMapper.ts
huntiqService.ts

Keep HUNTIQ-specific logic out of generic scraper/crawler code.

The sync endpoint should be:

POST /api/integrations/huntiq/sync

The browser may submit only:

{
  "records": [...]
}

or a server-owned scrape job reference if that better matches the existing architecture.

The server adds:

- destination URL
- authentication
- request ID
- integration metadata

==================================================
PHASE 5 — VERSIONED PAYLOAD
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
    "website": null
  },
  "contacts": [
    {
      "email": "john@example.com",
      "emailType": "PERSONAL",
      "emailStatus": "FOUND",
      "confidence": 0.96,
      "sourceUrl": "https://example.com/team",
      "sourceType": "TEAM_PAGE",
      "name": null,
      "jobTitle": null,
      "phone": null,
      "socials": {}
    }
  ]
}

Use strict TypeScript interfaces.

Validate all payloads before transmission.

==================================================
PHASE 6 — STOP FABRICATING COMPANY DATA
==================================================

Remove any logic that does:

domain
→ generated company name

For example:

acme-demo.com
→ Acme Demo

This must not be presented as discovered company information.

Also remove logic that automatically constructs:

https://domain.com

and presents it as a discovered website when it was not actually known.

The correct behavior is:

{
  "company": {
    "name": null,
    "domain": "acme-demo.com",
    "website": null
  }
}

Only send a company name if it was actually discovered from a source.

Only send a website if it was actually part of the discovered/crawled data.

==================================================
PHASE 7 — SEPARATE DISCOVERED IDENTITY FROM INFERRED IDENTITY
==================================================

Do not treat:

john.smith@example.com

as proof that the person's name is:

John Smith

If useful, inference may be preserved separately:

{
  "email": "john.smith@example.com",
  "name": null,
  "identityInference": {
    "firstName": "John",
    "lastName": "Smith",
    "source": "EMAIL_LOCAL_PART",
    "confidence": 0.45
  }
}

But this inferred value must never be mixed with verified website data.

If the crawler actually finds:

John Smith
Chief Executive Officer

on a source page, then:

{
  "name": "John Smith",
  "jobTitle": "Chief Executive Officer",
  "identitySource": "WEBSITE",
  "confidence": 0.98
}

Clearly distinguish:

DISCOVERED
INFERRED
UNKNOWN

==================================================
PHASE 8 — REMOVE OUTREACH RESPONSIBILITY
==================================================

Remove:

Create Outreach Draft

from the HUNTIQ sync payload and integration behavior.

Do not send:

createOutreachDraft: true

or any equivalent CRM/outreach command.

The scraper discovers contacts only.

HUNTIQ decides:

- whether the company qualifies
- whether the contact qualifies
- whether a lead is created
- whether an outreach draft is generated
- whether any outreach is sent

Do not break the scraper's normal export or contact functionality.

==================================================
PHASE 9 — HUNTIQ CONNECTION TEST
==================================================

Keep or refactor the connection test endpoint:

POST /api/integrations/huntiq/test

It must use server-side configuration only.

Validate:

- HUNTIQ_API_URL exists
- HUNTIQ_API_KEY exists
- destination is reachable
- authentication succeeds
- response is valid

Return:

{
  "success": true,
  "integration": "huntiq",
  "reachable": true,
  "authenticated": true
}

Never return:

API key
authorization header
environment variable values
workspace secrets

==================================================
PHASE 10 — IDEMPOTENCY AND RETRIES
==================================================

Every sync request must have a UUID requestId.

Send:

Idempotency-Key: <requestId>

Implement controlled retry behavior.

Retry only transient errors such as:

408
429 where appropriate
5xx
network failures

Do not retry:

400
401
403
422

Use:

- timeout
- exponential backoff
- maximum retry count

Do not create duplicate syncs after retry.

==================================================
PHASE 11 — HARDEN SSRF PROTECTION
==================================================

The scraper accepts URLs and crawls them.

Implement a reusable URL safety validation module.

Before crawling:

- allow only http and https
- reject localhost
- reject localhost subdomains where resolvable
- reject 127.0.0.0/8
- reject ::1
- reject 0.0.0.0
- reject RFC1918 private ranges
- reject link-local addresses
- reject cloud metadata endpoints
- reject IPv6 private/local ranges where appropriate
- validate DNS resolution
- inspect redirect destinations
- revalidate every redirect URL

Explicitly protect common cloud metadata addresses such as:

169.254.169.254

Do not rely only on string matching.

Validate resolved IP addresses.

Protect against DNS rebinding as far as practical by resolving and validating destinations immediately before outbound connections.

Apply this protection to all public crawl/fetch endpoints.

==================================================
PHASE 12 — ADD RESOURCE LIMITS
==================================================

Enforce configurable limits:

MAX_CRAWL_PAGES
MAX_CRAWL_DEPTH
MAX_CRAWL_CONCURRENCY
MAX_RESPONSE_BYTES
MAX_HTML_SIZE
MAX_REQUEST_BODY_BYTES
MAX_REDIRECTS
REQUEST_TIMEOUT_MS

Do not rely only on:

express.json({ limit: "10mb" })

Reject oversized responses before excessive memory usage.

Avoid loading arbitrarily large pages entirely into memory where possible.

==================================================
PHASE 13 — FIX DEAD EMAIL QUARANTINE DATA LOSS
==================================================

Review the new dead-email verification/quarantine flow.

Currently, undeliverable records must not disappear from the active result before quarantine persistence succeeds.

Implement safe ordering:

1. Verify email.
2. Prepare quarantine record.
3. Persist quarantine record successfully.
4. Confirm persistence.
5. Only then remove/archive the active record.

If quarantine persistence fails:

- keep the original active record
- return an explicit error
- do not silently discard the record

The operation should be recoverable.

Do not claim the email was safely quarantined until persistence succeeds.

==================================================
PHASE 14 — JOB STATE
==================================================

The current activeJobs Map can remain for:

local development
temporary runtime state
SSE telemetry

But do not present it as durable production infrastructure.

Document that it is ephemeral.

Do not introduce fake persistence.

For production HUNTIQ integration, include stable job metadata where possible:

jobId
status
startedAt
completedAt
pagesVisited
emailsFound
errors

Statuses:

QUEUED
RUNNING
COMPLETED
PARTIAL
CANCELLED
FAILED

If this application is later deployed in a serverless environment, the integration must not rely on the Map surviving across instances.

Do not redesign the entire job architecture in this fix unless necessary.

==================================================
PHASE 15 — VALIDATION AND AUTHENTICATION
==================================================

Validate all integration requests.

Add rate limiting to public integration endpoints where appropriate.

Use secure request parsing.

Limit request sizes.

Never log:

API keys
Authorization headers
tokens
secrets

Mask sensitive configuration in diagnostics.

==================================================
PHASE 16 — FRONTEND
==================================================

Do not redesign the scraper UI.

Remove only the insecure HUNTIQ controls:

- API Key input
- Workspace ID input
- editable HUNTIQ API URL

Replace them with a simple integration status area.

Example:

HUNTIQ Integration

Status: Connected

Server-managed connection

[ Test Connection ]

The browser must not display the secret.

If integration is not configured:

Status: Not Configured

[ Contact Administrator ]

The sync button should continue to work when server-side HUNTIQ configuration exists.

==================================================
PHASE 17 — TESTS
==================================================

Update existing tests.

Remove tests that expect fabricated data.

Do not assert:

domain → generated company name

or:

email → verified first/last name

Add tests for:

1. Missing HUNTIQ configuration
2. Successful server-side configuration
3. API key is never returned to frontend
4. Client API key is ignored/rejected
5. Client workspace ID is ignored/rejected
6. Client HUNTIQ URL is ignored/rejected
7. Successful sync
8. Connection test
9. 401 does not retry
10. 403 does not retry
11. 5xx retries
12. Network failure retry
13. Timeout handling
14. Idempotency key
15. Duplicate request behavior
16. No fabricated company name
17. No fabricated website
18. Inferred identity is explicitly marked
19. Verified identity remains separate
20. No automatic outreach
21. localhost blocked
22. 127.0.0.1 blocked
23. RFC1918 IP blocked
24. cloud metadata IP blocked
25. unsafe redirect blocked
26. oversized response blocked
27. crawl page limit enforced
28. crawl depth limit enforced
29. quarantine persistence failure does not lose data
30. successful quarantine archives correctly

==================================================
PHASE 18 — SEARCH FOR OLD INSECURE LOGIC
==================================================

Before finishing, search the entire repository for:

ws-default-001
ws-main
user-default
huntiqApiUrl
createOutreachDraft
localStorage
HUNTIQ_API_KEY
x-workspace-id

Inspect every match.

Remove insecure behavior from the HUNTIQ integration path.

Do not remove unrelated legitimate localStorage usage unless it stores integration credentials.

==================================================
PHASE 19 — README AND ENV EXAMPLE
==================================================

Update:

README.md

and:

.env.example

Document:

HUNTIQ_API_URL
HUNTIQ_API_KEY
HUNTIQ_INTEGRATION_ENABLED

Do not put real credentials in the repository.

Document:

- server-managed credentials
- connection testing
- sync flow
- payload version
- retry behavior
- idempotency
- security limits

==================================================
FINAL QUALITY GATE
==================================================

Before completing:

1. Run npm test.
2. Run npm run build.
3. Run npm run lint if available.
4. Fix all failures.
5. Inspect the git diff.
6. Confirm no API key is exposed to the browser.
7. Confirm no client-controlled workspace is trusted.
8. Confirm no arbitrary HUNTIQ URL can be submitted.
9. Confirm no fabricated company data is sent as discovered.
10. Confirm inferred identity is clearly marked.
11. Confirm outreach is not controlled by email-scraper.
12. Confirm SSRF protection works.
13. Confirm resource limits work.
14. Confirm quarantine cannot silently lose records.

Do not claim completion until tests/build pass.

At the end, provide:

1. Files changed
2. What was fixed
3. API contract
4. Environment variables required
5. Tests run and results
6. Any remaining limitations

Do not modify the HUNTIQ repository during this task.

This task is strictly to make email-scraper a secure, clean, evidence-based discovery service ready for HUNTIQ integration.