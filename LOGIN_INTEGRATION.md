# Staff sign-in and account integration

This reviewed local integration extends upstream `Hello000123/reshow` commit `0135d33dd1ec5428112ec7308a71b524a9452360`. It has not been pushed to that repository. Website account administration uses the live AWS service. Overview, Exhibits, Labels, Activity, Reports and the expandable staff/card demonstration still use clearly labelled browser-local data. A demo role grants no live API access.

## Run and configure

Serve this directory at `http://localhost:8000` for local development. The exact deployed origin is `https://dkbznu9f5nh9n.cloudfront.net`. Other origins/ports fail closed. `/auth/callback.html` serves the same dashboard DOM with `<base href="/">`. The EC2 static packager includes `auth/`; CloudFront MinTTL is zero and the callback sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Static request logs redact query strings.

The browser reads public configuration from `https://urauw4ckw1.execute-api.us-east-1.amazonaws.com/auth/config`. Required scope is only `reshow/staff`; the flow does not request an ID token. The browser validates an exact callback allowlist, uses code flow with WebCrypto PKCE S256 and random OAuth state, and consumes one ten-minute sessionStorage login transaction. No access/refresh tokens or staff records are stored persistently. The callback removes code/state from the visible URL before exchanging the code; it completes inside the same page so its memory session survives the safe history replacement to `/#staff`.

The provider handles passwords, first-login requirements, verification and password recovery. Public self-registration is disabled in infrastructure. There is no custom password field, local password fallback, client secret or embedded shared producer token.

## Small service interface

`js/auth-session.js` exports `staffSession` with `startSignIn('#staff')`, `completeCallback()`, `readSession()`, `snapshot()`, `subscribe(listener)`, `request(path, options)` and `signOut()`.

`request` prefixes paths with `/staff-api`, supplies only the in-memory access token, and never decodes a JWT to decide authorization. `GET /staff-api/session` supplies the stable `staff_id`, issuer/subject, current account status, role and permissions. Website role/account state is checked by the server for each call.

The Staff access tab includes these live operations:

- Administrator: follow all pages of `GET /staff-api/staff` and `/staff-api/accounts`, even empty pages with a non-null cursor.
- Administrator: explicitly create staff and send an invitation using `POST /staff-api/staff` followed by `/staff-api/accounts/invitations` with `delivery: "email"`. The form freezes its IDs/payload for retries after an ambiguous response; it never automatically sends another invitation. Existing directory records can be invited without duplicate entry.
- Administrator: change an account role or disable/restore website access with `PATCH /staff-api/accounts/{staff_id}` and `If-Match: <current version>`. A 409 reloads current records and requires review; it never silently overwrites or retries a change.
- Administrator: explicitly resend invitation email with a stable request ID, or resume the original provisioning request.
- Operator/Viewer: read only their own session/role/permissions. The panel never fetches the restricted staff directory for these roles.

The invite and resend buttons send real emails when an authorized Administrator intentionally uses them. No invitation is sent merely by loading the page. Initial real Administrator enrollment remains a separate controlled bootstrap, prepared by the deployment owner.

## Expiry, sign-out and failures

Access tokens expire after at most fifteen minutes. Expiry clears memory and prompts one user action to sign in again. Reloading loses the memory session; the user can explicitly re-enter through the provider browser session. No silent refresh/redirect loop is implemented. Local demo work remains separate and available.

Sign-out first clears live account content and broadcasts a token-free sign-out signal to other tabs, requests application-wide session revocation, attempts refresh-token revocation and ends the provider browser session. If application revocation cannot be confirmed, the page clears its local session, explains that another access token may remain valid for up to fifteen minutes and offers an explicit provider-session sign-out link. It does not claim global revocation succeeded.

401 clears the session and asks for sign-in. An unavailable/disabled account clears live account data and asks the user to contact an Administrator. 403 permission errors remain distinct from expiry. Network errors never automatically retry mutations: the action may already have happened. Refresh current state first. Account records, pending forms containing contact information and live directory caches are removed when identity changes or signs out. Browser-local demonstration forms/data remain separately labelled.

## Verification boundary

The focused Node tests exercise protocol/state tampering, PKCE, expiry, account unavailability, memory-only credentials, exact origins, If-Match, ambiguous requests and cross-tab sign-out with synthetic responses. Static-server tests exercise real local HTTP response headers and dummy-query log redaction. A local browser renders the signed-out live account panel and separate expandable demo. These checks do not prove Cognito invitation delivery or a real user's first sign-in; report those only after separate authorized live verification.
