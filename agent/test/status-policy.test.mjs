import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHECK_GAP_MS, observeStatus, OFFLINE_MIN_DURATION_MS } from "../status-policy.js";

const start = Date.parse("2026-10-12T03:00:00Z");
function observe(previous, status, minutes = 0, targetKey = "target-a") {
  return observeStatus(previous, {
    status, now: start + minutes * 60000, targetKey, incidentId: "incident-a"
  });
}

test("baseline records a real observation but does not immediately alert", () => {
  const result = observe(null, "offline");
  assert.equal(result.transition.kind, "baseline");
  assert.equal(result.transition.fromStatus, null);
  assert.equal(result.incidentAction, null);
  assert.equal(result.state.consecutiveOffline, 1);
});

test("Offline requires three observations and ten minutes, then alerts only once", () => {
  const first = observe(null, "offline");
  const second = observe(first.state, "offline", 5);
  assert.equal(second.incidentAction, null);
  const third = observe(second.state, "offline", 10);
  assert.equal(third.incidentAction.type, "open");
  assert.equal(third.incidentAction.offlineSince, start);
  assert.equal(third.transition, null);
  const fourth = observe(third.state, "offline", 15);
  assert.equal(fourth.incidentAction, null);
  assert.equal(fourth.state.activeIncidentId, "incident-a");
});

test("rapid checks cannot bypass the duration threshold", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 1).state;
  assert.equal(observe(state, "offline", 2).incidentAction, null);
});

test("Online resolves an existing incident once and resets the Offline streak", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 5).state;
  state = observe(state, "offline", 10).state;
  const recovered = observe(state, "online", 15);
  assert.equal(recovered.incidentAction.type, "resolve");
  assert.equal(recovered.state.activeIncidentId, null);
  assert.equal(recovered.state.consecutiveOffline, 0);
  assert.equal(observe(recovered.state, "online", 20).incidentAction, null);
  assert.equal(observe(recovered.state, "offline", 20).state.consecutiveOffline, 1);
});

test("flapping before confirmation does not create incidents", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 5).state;
  const recovered = observe(state, "online", 10);
  assert.equal(recovered.incidentAction, null);
  const offlineAgain = observe(recovered.state, "offline", 15);
  assert.equal(offlineAgain.state.offlineSince, start + 15 * 60000);
  assert.equal(offlineAgain.state.consecutiveOffline, 1);
});

test("Agent gaps and failed observations reset an unconfirmed streak", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 5).state;
  const afterGap = observeStatus(state, {
    status: "offline", now: state.lastObservedAt + MAX_CHECK_GAP_MS + 1,
    targetKey: "target-a", incidentId: "incident-a"
  });
  assert.equal(afterGap.state.consecutiveOffline, 1);
  assert.equal(afterGap.incidentAction, null);
  const afterFailure = observe({ ...state, observationInterrupted: true }, "offline", 10);
  assert.equal(afterFailure.state.consecutiveOffline, 1);
  assert.equal(afterFailure.incidentAction, null);
});

test("Agent restart retains a confirmed incident and does not notify again", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 5).state;
  state = observe(state, "offline", 10).state;
  const restarted = observe(JSON.parse(JSON.stringify(state)), "offline", 60);
  assert.equal(restarted.incidentAction, null);
  assert.equal(restarted.state.activeIncidentId, "incident-a");
  assert.equal(restarted.state.offlineSince, start);
  assert.equal(restarted.observationGap, true);
});

test("changing monitored IP closes the old incident without reporting a recovery", () => {
  let state = observe(null, "offline").state;
  state = observe(state, "offline", 5).state;
  state = observe(state, "offline", 10).state;
  const changed = observe(state, "offline", 15, "target-b");
  assert.equal(changed.incidentAction.type, "close");
  assert.equal(changed.incidentAction.reason, "target_changed");
  assert.equal(changed.state.activeIncidentId, null);
  assert.equal(changed.state.consecutiveOffline, 1);
  assert.equal(changed.transition.kind, "target_changed");
});

test("invalid status cannot become an Offline event", () => {
  assert.throws(() => observe(null, "error"), /Invalid status/);
  assert.equal(OFFLINE_MIN_DURATION_MS, 600000);
});
