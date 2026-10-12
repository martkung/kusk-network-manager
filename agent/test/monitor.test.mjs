import assert from "node:assert/strict";
import test from "node:test";
import { startMonitor } from "../monitor.js";

function fixture(checkDevices, publishHealth) {
  const writes = [];
  const timers = new Map();
  return {
    writes,
    timers,
    options: {
      checkDevices,
      publishHealth: publishHealth || (async (data) => { writes.push(data); }),
      timestamp: () => "SERVER_TIME",
      onError() {},
      schedule(callback, interval) {
        timers.set(interval, callback);
        return interval;
      },
      cancel: (timer) => timers.delete(timer)
    }
  };
}

test("heartbeat continues during a long check and checks never overlap", async () => {
  let finish;
  let checkCount = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const setup = fixture(async () => {
    checkCount += 1;
    return pending;
  });
  const monitor = await startMonitor(setup.options);
  const first = monitor.runCheck();
  const second = monitor.runCheck();
  assert.equal(first, second);
  await monitor.heartbeat();
  assert.equal(checkCount, 1);
  assert.deepEqual(setup.writes.at(-1), { lastAgentSeen: "SERVER_TIME" });
  assert.ok(setup.timers.has(60000));
  finish({ total: 2, checked: 2, failed: 0, skipped: 0 });
  await first;
  assert.equal(setup.writes.at(-1).phase, "idle");
  assert.equal(setup.writes.at(-1).lastSuccessfulCheckAt, "SERVER_TIME");
  await monitor.stop();
  assert.equal(setup.timers.size, 0);
  assert.equal(setup.writes.at(-1).phase, "stopped");
});

test("failed or skipped devices do not advance last successful check", async () => {
  for (const result of [
    { total: 2, checked: 1, failed: 1, skipped: 0 },
    { total: 2, checked: 1, failed: 0, skipped: 1 }
  ]) {
    const setup = fixture(async () => result);
    const monitor = await startMonitor(setup.options);
    await monitor.runCheck();
    const write = setup.writes.at(-1);
    assert.equal(write.phase, "degraded");
    assert.equal(Object.hasOwn(write, "lastSuccessfulCheckAt"), false);
    assert.equal(write.lastCheckCompletedAt, "SERVER_TIME");
    await monitor.stop();
  }
});

test("inventory read failure degrades health and a later check recovers", async () => {
  let fail = true;
  const setup = fixture(async () => {
    if (fail) { throw new Error("Firestore unavailable"); }
    return { total: 1, checked: 1, failed: 0, skipped: 0 };
  });
  const monitor = await startMonitor(setup.options);
  await monitor.runCheck();
  assert.equal(setup.writes.at(-1).phase, "degraded");
  fail = false;
  await monitor.runCheck();
  assert.equal(setup.writes.at(-1).phase, "idle");
  await monitor.stop();
});

test("publication failure is retried by the next heartbeat", async () => {
  let fail = true;
  const writes = [];
  const setup = fixture(async () => ({ total: 0, checked: 0, failed: 0, skipped: 0 }),
    async (data) => {
      if (fail) { throw new Error("Network unavailable"); }
      writes.push(data);
    });
  const monitor = await startMonitor(setup.options);
  await monitor.runCheck();
  fail = false;
  await monitor.heartbeat();
  assert.equal(writes.at(-1).lastAgentSeen, "SERVER_TIME");
  await monitor.stop();
});

test("shutdown cannot record an interrupted check as successful", async () => {
  let finish;
  let stoppingCheck;
  const pending = new Promise((resolve) => { finish = resolve; });
  const setup = fixture(async (isStopping) => {
    stoppingCheck = isStopping;
    return pending;
  });
  const monitor = await startMonitor(setup.options);
  await monitor.heartbeat();
  const stopped = monitor.stop();
  assert.equal(stoppingCheck(), true);
  finish({ total: 1, checked: 1, failed: 0, skipped: 0 });
  await stopped;
  assert.equal(setup.writes.some((write) => write.lastSuccessfulCheckAt), false);
  assert.equal(setup.writes.at(-1).phase, "stopped");
});
