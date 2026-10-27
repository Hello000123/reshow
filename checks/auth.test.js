import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createStaffSession, safeReturnHash } from "../js/auth-session.js";
const ORIGIN = "https://dkbznu9f5nh9n.cloudfront.net";
const CONFIG = {
  client_id: "publicclient123", issuer: "https://cognito-idp.us-east-1.amazonaws.com/unit",
  authorization_endpoint: "https://staff.example.test/oauth2/authorize", token_endpoint: "https://staff.example.test/oauth2/token",
  revocation_endpoint: "https://staff.example.test/oauth2/revoke", logout_endpoint: "https://staff.example.test/logout",
  allowed_callback_urls: [ORIGIN + "/auth/callback.html", "http://localhost:8000/auth/callback.html"],
  allowed_logout_urls: [ORIGIN + "/", "http://localhost:8000/"], staff_api_prefix: "/staff-api", scopes: ["reshow/staff"], access_token_seconds: 900,
};
const USER = { staff_id: "test-staff", subject: "subject", issuer: CONFIG.issuer, name: "Synthetic Test", email: "test@example.invalid", role: "Viewer", account_status: "active", account_version: 1,
  permissions: { view: true, save_reports: false, edit_exhibits: false, device_commands: false, manage_staff: false, manage_accounts: false, physical_cards: false, submit_producer_evidence: false } };
const TOKENS = { access_token: "synthetic-access-token-without-JWT", refresh_token: "synthetic-refresh-token", token_type: "Bearer", expires_in: 900 };
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) });
function harness(options = {}) {
  const persisted = new Map(), calls = [], moves = [], events = [], timers = new Map(), messages = [];
  let time = 1000000, timerId = 0, handler = null;
  const location = { origin: ORIGIN, pathname: "/", search: "", assign: (url) => moves.push(url), ...options.location };
  const channel = { postMessage: (message) => messages.push(message), close() {}, onmessage: null };
  const runtime = {
    crypto: webcrypto, location, channel, now: () => time,
    history: { replaceState(_state, _title, url) { events.push(["history", url]); const u = new URL(url, location.origin); location.pathname = u.pathname; location.search = u.search; } },
    storage: { setItem(key, value) { persisted.set(key, value); }, getItem(key) { return persisted.get(key) || null; }, removeItem(key) { persisted.delete(key); } },
    setTimeout(fn, delay) { const identity = ++timerId; timers.set(identity, { fn, delay }); return identity; }, clearTimeout(identity) { timers.delete(identity); },
    async fetch(url, init) {
      calls.push({ url, init }); events.push(["fetch", url]);
      if (url.endsWith("/auth/config")) return response(options.config || CONFIG);
      if (handler) { const result = await handler(url, init); if (result) return result; }
      if (url === CONFIG.token_endpoint) return response(TOKENS);
      if (url.endsWith("/staff-api/session")) return response({ user: USER });
      if (url.endsWith("/staff-api/session/logout")) return response({ application_sessions_revoked: true });
      if (url === CONFIG.revocation_endpoint) return response({});
      return response({ items: [], next_cursor: null });
    },
  };
  const session = createStaffSession(runtime);
  async function start() {
    await session.startSignIn("#staff");
    return JSON.parse([...persisted.values()][0]);
  }
  async function authenticate(change = {}) {
    const transaction = await start();
    location.pathname = "/auth/callback.html";
    location.search = "?" + new URLSearchParams({ state: transaction.state, code: "synthetic-authorization-code", ...change });
    await session.completeCallback();
    return transaction;
  }
  return { session, runtime, calls, moves, persisted, events, location, channel, timers, messages, start, authenticate,
    setHandler(fn) { handler = fn; }, advance(delta) { time += delta; } };
}

test("PKCE uses S256, exact callback, custom access scope and only one expiring transaction", async () => {
  const h = harness();
  const transaction = await h.start();
  const authorize = new URL(h.moves[0]);
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.equal(authorize.searchParams.get("scope"), "reshow/staff");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const challenge = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(transaction.verifier))).toString("base64url");
  assert.equal(authorize.searchParams.get("code_challenge"), challenge);
  assert.equal(authorize.searchParams.get("redirect_uri"), ORIGIN + "/auth/callback.html");
  assert.equal(transaction.returnHash, "#staff");
  assert.equal(h.persisted.size, 1);
  assert.deepEqual(Object.keys(transaction).sort(), ["created", "redirectUri", "returnHash", "state", "verifier"]);
  assert.equal(safeReturnHash("https://evil.invalid"), "#staff");
  assert.equal(safeReturnHash("#staff?redirect=evil"), "#staff");
  h.session.dispose();
});

test("callback removes query before exchange; session authority is backend and tokens are memory only", async () => {
  const h = harness();
  await h.authenticate();
  const tokenIndex = h.events.findIndex(([kind, url]) => kind === "fetch" && url === CONFIG.token_endpoint);
  const cleanIndex = h.events.findIndex(([kind, url]) => kind === "history" && url === "/#staff");
  assert.ok(cleanIndex >= 0 && cleanIndex < tokenIndex);
  assert.equal(h.persisted.size, 0);
  assert.equal(h.session.snapshot().user.role, "Viewer");
  assert.ok(!JSON.stringify(h.session.snapshot()).includes(TOKENS.access_token));
  assert.ok(!h.moves.some((url) => url.includes(TOKENS.access_token) || url.includes(TOKENS.refresh_token)));
  const exchange = h.calls.find(({ url }) => url === CONFIG.token_endpoint);
  const values = new URLSearchParams(exchange.init.body);
  assert.equal(values.get("grant_type"), "authorization_code");
  assert.equal(values.get("code"), "synthetic-authorization-code");
  assert.ok(!values.has("client_secret"));
  const request = h.calls.find(({ url }) => url.endsWith("/staff-api/session"));
  assert.equal(request.init.headers.authorization, "Bearer " + TOKENS.access_token);
  assert.equal(request.init.credentials, "omit");
  h.session.dispose();
});

test("invalid, expired, future-dated and altered-return transactions never exchange a code", async () => {
  for (const kind of ["state", "expired", "future", "return", "duplicate-state", "duplicate-code", "missing-code"]) {
    const h = harness();
    const transaction = await h.start();
    const key = [...h.persisted.keys()][0];
    if (kind === "expired") h.advance(600001);
    if (kind === "future") transaction.created += 1;
    if (kind === "return") transaction.returnHash = "//evil.invalid/";
    h.persisted.set(key, JSON.stringify(transaction));
    h.location.pathname = "/auth/callback.html";
    const params = new URLSearchParams({ state: kind === "state" ? "tampered" : transaction.state, code: "synthetic-code" });
    if (kind === "duplicate-state") params.append("state", transaction.state);
    if (kind === "duplicate-code") params.append("code", "second");
    if (kind === "missing-code") params.delete("code");
    h.location.search = "?" + params;
    await assert.rejects(h.session.completeCallback(), /invalid|expired/);
    assert.ok(!h.calls.some(({ url }) => url === CONFIG.token_endpoint), kind);
    assert.equal(h.persisted.size, 0);
    assert.equal(h.session.snapshot().user, null);
    h.session.dispose();
  }
});

test("provider cancellation is generic and cannot display an email or provider error description", async () => {
  const h = harness();
  const transaction = await h.start();
  h.location.pathname = "/auth/callback.html";
  h.location.search = "?" + new URLSearchParams({ state: transaction.state, error: "access_denied", error_description: "private-person@example.invalid" });
  await assert.rejects(h.session.completeCallback(), /cancelled/);
  assert.ok(!h.session.snapshot().message.includes("private-person"));
  assert.ok(!h.calls.some(({ url }) => url === CONFIG.token_endpoint));
  h.session.dispose();
});

test("callback origin allowlist supports only configured production or localhost8000", async () => {
  const local = harness({ location: { origin: "http://localhost:8000" } });
  await local.start();
  assert.equal(new URL(local.moves[0]).searchParams.get("redirect_uri"), "http://localhost:8000/auth/callback.html");
  local.session.dispose();
  for (const origin of ["https://evil.invalid", "http://localhost:8001", "https://localhost:8000"]) {
    const h = harness({ location: { origin } });
    await assert.rejects(h.start(), /exact website address/);
    assert.equal(h.moves.length, 0);
    h.session.dispose();
  }
});

test("authorization purpose/configuration changes fail closed", async () => {
  for (const change of [{ scopes: ["openid", "reshow/staff"] }, { client_id: "bad client" }, { token_endpoint: "https://another.example.test/oauth2/token" }]) {
    const h = harness({ config: { ...CONFIG, ...change } });
    await assert.rejects(h.start());
    assert.equal(h.moves.length, 0);
    h.session.dispose();
  }
});

test("expiry and 401 clear identity without any renewal or redirect loop", async () => {
  const h = harness();
  await h.authenticate();
  const expiry = [...h.timers.values()].find(({ delay }) => delay === 900000);
  assert.ok(expiry);
  const prior = h.calls.length;
  expiry.fn();
  assert.equal(h.session.snapshot().status, "session_expired");
  await assert.rejects(h.session.request("/accounts"), (error) => error.status === 401);
  assert.equal(h.calls.length, prior);
  assert.equal(h.moves.length, 1);
  h.session.dispose();
  const denied = harness();
  await denied.authenticate();
  denied.setHandler((url) => url.endsWith("/accounts") ? response({ error: { code: "session_expired", message: "Expired" } }, 401) : null);
  await assert.rejects(denied.session.request("/accounts"), (error) => error.status === 401);
  assert.equal(denied.session.snapshot().user, null);
  denied.session.dispose();
});

test("disabled account clears cached user, forbidden action does not fabricate an elevated identity", async () => {
  const h = harness();
  await h.authenticate();
  h.setHandler((url) => url.endsWith("/accounts") ? response({ error: { code: "forbidden", message: "Administrator required" } }, 403) : null);
  await assert.rejects(h.session.request("/accounts"), (error) => error.status === 403);
  assert.equal(h.session.snapshot().user.role, "Viewer");
  h.setHandler((url) => url.endsWith("/session") ? response({ error: { code: "account_unavailable", message: "Unavailable" } }, 403) : null);
  await assert.rejects(h.session.readSession());
  assert.equal(h.session.snapshot().status, "disabled_account");
  assert.equal(h.session.snapshot().user, null);
  h.session.dispose();
});

test("If-Match forwarded exactly; ambiguous mutations are never automatically retried", async () => {
  const h = harness();
  await h.authenticate();
  let attempts = 0;
  h.setHandler((url, init) => {
    if (url.endsWith("/accounts/test-staff")) {
      attempts += 1;
      assert.equal(init.headers["if-match"], "7");
      assert.deepEqual(JSON.parse(init.body), { role: "Viewer" });
      throw new Error("synthetic lost response");
    }
    return null;
  });
  await assert.rejects(h.session.request("/accounts/test-staff", { method: "PATCH", body: { role: "Viewer" }, version: 7 }), /may already have happened/);
  assert.equal(attempts, 1);
  assert.equal(h.persisted.size, 0);
  h.session.dispose();
});

test("logout revokes application before refresh token and clears other tabs with no token message", async () => {
  const h = harness();
  await h.authenticate();
  const phases = [];
  h.session.subscribe((state) => phases.push(state));
  const result = await h.session.signOut();
  const urls = h.calls.map(({ url }) => url);
  assert.ok(urls.indexOf(CONFIG.revocation_endpoint) > urls.findIndex((url) => url.endsWith("/session/logout")));
  assert.equal(result.applicationRevoked, true);
  assert.equal(new URL(result.logoutUrl).searchParams.get("logout_uri"), ORIGIN + "/");
  assert.equal(h.session.snapshot().user, null);
  assert.ok(phases.find((state) => state.status === "signing_out" && state.user === null));
  assert.deepEqual(h.messages, [{ type: "signout" }]);
  assert.equal(h.persisted.size, 0);
  const other = harness();
  await other.authenticate();
  other.channel.onmessage({ data: { type: "signout" } });
  assert.equal(other.session.snapshot().user, null);
  assert.equal(other.session.snapshot().status, "signed_out");
  h.session.dispose(); other.session.dispose();
});

test("logout network failure reports unconfirmed global revocation and still clears local session", async () => {
  const h = harness();
  await h.authenticate();
  h.setHandler((url) => { if (url.endsWith("/session/logout")) throw new Error("synthetic network unavailable"); return null; });
  const result = await h.session.signOut();
  assert.equal(result.applicationRevoked, false);
  assert.equal(h.session.snapshot().user, null);
  assert.match(h.session.snapshot().message, /could not be confirmed/);
  assert.ok(h.calls.some(({ url }) => url === CONFIG.revocation_endpoint));
  assert.ok(result.logoutUrl);
  h.session.dispose();
});


test("a sign-out during the token exchange cannot restore a stale callback session", async () => {
  const h = harness();
  const transaction = await h.start();
  let release;
  let started;
  const exchangeStarted = new Promise((resolve) => { started = resolve; });
  h.setHandler((url) => {
    if (url !== CONFIG.token_endpoint) return null;
    started();
    return new Promise((resolve) => { release = () => resolve(response(TOKENS)); });
  });
  h.location.pathname = "/auth/callback.html";
  h.location.search = "?" + new URLSearchParams({ state: transaction.state, code: "synthetic-code" });
  const callback = h.session.completeCallback();
  await exchangeStarted;
  h.channel.onmessage({ data: { type: "signout" } });
  assert.equal(h.persisted.size, 0);
  release();
  await assert.rejects(callback, /session changed/);
  assert.equal(h.session.snapshot().user, null);
  assert.ok(!h.calls.some(({ url }) => url.endsWith("/staff-api/session")));
  await assert.rejects(h.session.request("/accounts"), (error) => error.status === 401);
  h.session.dispose();
});
