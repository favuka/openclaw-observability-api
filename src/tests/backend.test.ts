import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServer, assertLocalBind } from "../server.js";
import { sanitizeResponse } from "../security/sanitize.js";

test("sanitizer strips sensitive payloads", () => {
  const sanitized = sanitizeResponse({
    message:
      "Bearer sk_test_12345678901234567890 at /root/.openclaw/workspace with https://private-user-images.githubusercontent.com/file.png chat_id=8213682285",
    prompt: "full prompt must not leave",
    args: { token: "abc", path: "/root/.openclaw/secret" },
    metadata: {
      status: "ok",
      token: "abc",
      chat_id: "8213682285",
      path: "/root/.openclaw/secret"
    }
  });
  const text = JSON.stringify(sanitized);

  assert.equal("prompt" in sanitized, false);
  assert.equal("args" in sanitized, false);
  assert.match(text, /Bearer \[redacted\]/);
  assert.doesNotMatch(text, /sk_test/);
  assert.doesNotMatch(text, /\/root\/\.openclaw/);
  assert.doesNotMatch(text, /private-user-images/);
  assert.doesNotMatch(text, /8213682285/);
  assert.doesNotMatch(text, /full prompt/);
});

test("denied CORS origin returns controlled 403", async () => {
  const app = await buildServer();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" }
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { error: "cors_origin_denied" });
    assert.doesNotMatch(response.body, /stack|trace/i);
  } finally {
    await app.close();
  }
});

test("run detail does not embed full event list", async () => {
  const app = await buildServer();
  try {
    const runsResponse = await app.inject("/api/runs?limit=1");
    assert.equal(runsResponse.statusCode, 200);
    const runs = JSON.parse(runsResponse.body) as Array<{ id: string }>;
    assert.ok(runs.length > 0, "expected at least one OpenClaw run for integration check");

    const detailResponse = await app.inject(`/api/runs/${encodeURIComponent(runs[0].id)}`);
    assert.equal(detailResponse.statusCode, 200);
    const detail = JSON.parse(detailResponse.body) as Record<string, unknown>;
    assert.equal(Array.isArray(detail.events), false);
    assert.equal("events" in detail, false);
  } finally {
    await app.close();
  }
});

test("events endpoint respects limit", async () => {
  const app = await buildServer();
  try {
    const runsResponse = await app.inject("/api/runs?limit=1");
    assert.equal(runsResponse.statusCode, 200);
    const runs = JSON.parse(runsResponse.body) as Array<{ id: string }>;
    assert.ok(runs.length > 0, "expected at least one OpenClaw run for integration check");

    const eventsResponse = await app.inject(`/api/runs/${encodeURIComponent(runs[0].id)}/events?limit=5`);
    assert.equal(eventsResponse.statusCode, 200);
    const events = JSON.parse(eventsResponse.body) as unknown[];
    assert.equal(Array.isArray(events), true);
    assert.ok(events.length <= 5);
  } finally {
    await app.close();
  }
});

test("runs endpoint applies safe filters and pagination", async () => {
  const app = await buildServer();
  try {
    const runsResponse = await app.inject("/api/runs?limit=25");
    assert.equal(runsResponse.statusCode, 200);
    const runs = JSON.parse(runsResponse.body) as Array<{
      id: string;
      agentId: string;
      agentName: string;
      status: string;
      summary: string;
      origin: { source: string };
    }>;
    assert.ok(runs.length > 0, "expected at least one OpenClaw run for filter check");

    const first = runs[0];
    const statusResponse = await app.inject(`/api/runs?status=${encodeURIComponent(first.status)}`);
    const statusRuns = JSON.parse(statusResponse.body) as typeof runs;
    assert.ok(statusRuns.length > 0);
    assert.ok(statusRuns.every((run) => run.status === first.status));

    const agentIdResponse = await app.inject(`/api/runs?agentId=${encodeURIComponent(first.agentId)}`);
    const agentIdRuns = JSON.parse(agentIdResponse.body) as typeof runs;
    assert.ok(agentIdRuns.length > 0);
    assert.ok(agentIdRuns.every((run) => run.agentId === first.agentId));

    const agentResponse = await app.inject(`/api/runs?agent=${encodeURIComponent(first.agentName.slice(0, 4))}`);
    const agentRuns = JSON.parse(agentResponse.body) as typeof runs;
    assert.ok(agentRuns.length > 0);
    assert.ok(
      agentRuns.every(
        (run) =>
          run.agentId === first.agentId ||
          run.agentName.toLowerCase().includes(first.agentName.slice(0, 4).toLowerCase())
      )
    );

    const term = first.summary.split(/\s+/).find((word) => word.length >= 4) ?? first.origin.source;
    const qResponse = await app.inject(`/api/runs?q=${encodeURIComponent(term)}`);
    const qRuns = JSON.parse(qResponse.body) as typeof runs;
    assert.ok(qRuns.length > 0);
    assert.ok(
      qRuns.every((run) =>
        `${run.agentName} ${run.summary} ${run.origin.source}`.toLowerCase().includes(term.toLowerCase())
      )
    );

    const searchResponse = await app.inject(`/api/runs?search=${encodeURIComponent(term)}&limit=1`);
    const searchRuns = JSON.parse(searchResponse.body) as typeof runs;
    assert.ok(searchRuns.length <= 1);
    assert.ok(searchRuns.length > 0);

    const pagedResponse = await app.inject("/api/runs?limit=1&offset=1");
    const pagedRuns = JSON.parse(pagedResponse.body) as typeof runs;
    assert.ok(pagedRuns.length <= 1);
    if (runs.length > 1 && pagedRuns.length === 1) assert.equal(pagedRuns[0].id, runs[1].id);

    const comboResponse = await app.inject(
      `/api/runs?status=${encodeURIComponent(first.status)}&agentId=${encodeURIComponent(first.agentId)}&q=${encodeURIComponent(term)}`
    );
    const comboRuns = JSON.parse(comboResponse.body) as typeof runs;
    assert.ok(comboRuns.length > 0);
    assert.ok(comboRuns.every((run) => run.status === first.status && run.agentId === first.agentId));
  } finally {
    await app.close();
  }
});

test("external bind is refused", () => {
  assert.throws(() => assertLocalBind("0.0.0.0"), /outside 127\.0\.0\.1/);
});
