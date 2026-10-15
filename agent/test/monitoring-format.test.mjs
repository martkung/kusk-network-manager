import assert from "node:assert/strict";
import test from "node:test";
import { incidentDuration } from "../../public/js/monitoring-format.js";

const start = Date.parse("2026-10-12T03:00:00Z");
test("Offline duration stops at the latest real observation when Agent disappears", () => {
  assert.equal(incidentDuration({ status: "open", offlineSince: start,
    lastObservedAt: start + 600000 }, start + 3600000), "10 นาที");
});
test("resolved incidents use the actual resolution time", () => {
  assert.equal(incidentDuration({ status: "resolved", offlineSince: start,
    lastObservedAt: start + 600000, resolvedAt: start + 3900000 }, start + 7200000), "1 ชม. 5 นาที");
});

test("deletion and IP changes end the observed Offline span at the last check", () => {
  assert.equal(incidentDuration({ status: "closed", offlineSince: start,
    lastObservedAt: start + 600000, resolvedAt: start + 3900000 }, start + 7200000), "10 นาที");
});
