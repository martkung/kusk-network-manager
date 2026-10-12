import assert from "node:assert/strict";
import test from "node:test";
import {
  agentHealthState,
  DEVICE_STALE_MS,
  HEARTBEAT_STALE_MS,
  inventoryFreshness,
  isDeviceDataStale,
  timestampMs
} from "../../public/js/agent-health-state.js";

const now = Date.parse("2026-10-12T03:00:00Z");
const fresh = {
  phase: "idle",
  lastAgentSeen: now - 30000,
  lastSuccessfulCheckAt: now - 300000
};

test("expired heartbeat is detected without another database event", () => {
  assert.equal(agentHealthState(fresh, { now }), "healthy");
  assert.equal(agentHealthState(fresh, { now: now + HEARTBEAT_STALE_MS }), "missing");
});

test("fresh heartbeat does not hide failed or stale device checks", () => {
  assert.equal(agentHealthState({ ...fresh, phase: "degraded" }, { now }), "degraded");
  assert.equal(agentHealthState({ ...fresh,
    lastSuccessfulCheckAt: now - DEVICE_STALE_MS }, { now }), "stale");
  assert.equal(agentHealthState({ ...fresh, phase: "running",
    checkStartedAt: now - DEVICE_STALE_MS }, { now }), "stale");
});

test("missing, stopped and first-run Agent have distinct states", () => {
  assert.equal(agentHealthState(null, { now }), "unknown");
  assert.equal(agentHealthState({ ...fresh, phase: "stopped" }, { now }), "stopped");
  assert.equal(agentHealthState({ phase: "running", lastAgentSeen: now,
    checkStartedAt: now }, { now }), "starting");
});

test("offline, cached or failed reads never imply a healthy Agent", () => {
  for (const options of [{ offline: true }, { fromCache: true }, { readFailed: true }]) {
    assert.equal(agentHealthState(fresh, { now, ...options }), "connection");
  }
});

test("unknown and future device timestamps are stale", () => {
  for (const time of [null, undefined, "", "invalid", now + 120000]) {
    assert.equal(isDeviceDataStale(time, now), true);
  }
  assert.equal(isDeviceDataStale(now - DEVICE_STALE_MS, now), true);
  assert.equal(isDeviceDataStale(now - DEVICE_STALE_MS + 1, now), false);
  assert.equal(timestampMs({ toMillis: () => now }), now);
  assert.equal(timestampMs(new Date(now)), now);
  assert.equal(timestampMs(new Date(now).toISOString()), now);
});

test("one recent device cannot hide other stale records", () => {
  assert.deepEqual(inventoryFreshness([
    { lastSeen: now - 1000 },
    { lastSeen: now - DEVICE_STALE_MS },
    { lastSeen: null }
  ], now), { total: 3, staleCount: 2, latestUpdate: now - 1000 });
});
