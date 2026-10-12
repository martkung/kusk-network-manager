import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import * as states from "../../public/js/agent-health-state.js";

const source = await readFile(new URL("../../public/js/agent-health.js", import.meta.url), "utf8");

async function fixture(context) {
  let now = Date.parse("2026-10-12T03:00:00Z");
  class Element {
    hidden = false;
    dataset = {};
    children = [];
    textContent = "";
    setAttribute() {}
    replaceChildren(...children) { this.children = children; }
  }
  const notice = new Element();
  const timers = new Map();
  const events = new Map();
  let subscription;
  let unsubscribed = false;
  const sandbox = createContext({
    console,
    Date,
    navigator: { onLine: true },
    document: {
      getElementById: () => notice,
      createElement: () => new Element(),
      addEventListener: (name, handler) => events.set(name, handler),
      removeEventListener: (name) => events.delete(name)
    },
    window: {
      setInterval(handler, milliseconds) { timers.set(milliseconds, handler); return milliseconds; },
      clearInterval: (id) => timers.delete(id),
      addEventListener: (name, handler) => events.set(name, handler),
      removeEventListener: (name) => events.delete(name)
    }
  });
  function synthetic(exports) {
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) { this.setExport(key, value); }
    }, { context: sandbox });
  }
  const stateExports = {
    ...states,
    agentHealthState: (health, options) => states.agentHealthState(health, { now, ...options }),
    inventoryFreshness: (devices) => states.inventoryFreshness(devices, now),
    isDeviceDataStale: (value) => states.isDeviceDataStale(value, now)
  };
  const module = new SourceTextModule(source, { context: sandbox });
  await module.link((specifier) => {
    if (specifier.startsWith("./firebase-config.js")) { return synthetic({ db: {} }); }
    if (specifier === "./agent-health-state.js") { return synthetic(stateExports); }
    return synthetic({
      doc: (_db, collection, id) => ({ collection, id }),
      onSnapshot: (ref, options, callback, onError) => {
        subscription = { ref, options, callback, onError };
        return () => { unsubscribed = true; };
      }
    });
  });
  await module.evaluate();
  const api = module.namespace.createAgentHealthNotice(context);
  return {
    api, notice, timers, events, sandbox,
    get now() { return now; },
    get subscription() { return subscription; },
    get unsubscribed() { return unsubscribed; },
    advance: (milliseconds) => { now += milliseconds; timers.get(30000)(); },
    updateStatus: module.namespace.updateDeviceStatus,
    Element
  };
}

test("guest warning uses only public records and never subscribes to private monitoring", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  setup.api.updateDevices([{ lastSeen: setup.now - 1000 }, { lastSeen: null }]);
  assert.equal(setup.subscription, undefined);
  assert.equal(setup.notice.dataset.state, "stale");
  assert.match(setup.notice.children[1].textContent, /1 จาก 2/);
  assert.doesNotMatch(setup.notice.children.map((child) => child.textContent).join(" "), /Agent/);
  setup.api.stop();
});

test("healthy guest data becomes stale as time passes without a snapshot", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  setup.api.updateDevices([{ lastSeen: setup.now }]);
  assert.equal(setup.notice.dataset.state, "healthy");
  setup.advance(states.DEVICE_STALE_MS);
  assert.equal(setup.notice.dataset.state, "stale");
  setup.api.stop();
});

test("viewer reads only the exact health document and detects a lost heartbeat", async () => {
  const setup = await fixture({ user: { uid: "viewer" }, role: "viewer" });
  assert.deepEqual(setup.subscription.ref, { collection: "monitoring", id: "networkAgent" });
  setup.subscription.callback({ exists: () => true, metadata: { fromCache: false },
    data: () => ({ phase: "idle", lastAgentSeen: setup.now, lastSuccessfulCheckAt: setup.now }) });
  assert.equal(setup.notice.dataset.state, "healthy");
  setup.advance(states.HEARTBEAT_STALE_MS);
  assert.equal(setup.notice.dataset.state, "missing");
  setup.api.stop();
  assert.equal(setup.unsubscribed, true);
  assert.equal(setup.timers.size, 0);
  assert.equal(setup.events.size, 0);
});

test("cached or failed inventory cannot show an authenticated healthy banner", async () => {
  const setup = await fixture({ user: { uid: "viewer" }, role: "viewer" });
  setup.subscription.callback({ exists: () => true, metadata: { fromCache: false },
    data: () => ({ phase: "idle", lastAgentSeen: setup.now, lastSuccessfulCheckAt: setup.now }) });
  setup.api.updateDevices([{ lastSeen: setup.now }], { fromCache: true });
  assert.equal(setup.notice.dataset.state, "connection");
  setup.api.updateDevices(null, { failed: true });
  assert.equal(setup.notice.dataset.state, "connection");
  setup.api.updateDevices([{ lastSeen: setup.now }]);
  assert.equal(setup.notice.dataset.state, "healthy");
  setup.sandbox.navigator.onLine = false;
  setup.events.get("offline")();
  assert.equal(setup.notice.dataset.state, "connection");
  setup.api.stop();
});

test("stale status badge keeps the last result but loses its current-status color", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  const badge = new setup.Element();
  setup.updateStatus(badge, "online", setup.now - states.DEVICE_STALE_MS);
  assert.equal(badge.className, "badge bg-secondary");
  assert.match(badge.textContent, /online.*ข้อมูลเก่า/);
  setup.updateStatus(badge, "offline", setup.now);
  assert.equal(badge.className, "badge bg-danger");
  assert.equal(badge.textContent, "offline");
  setup.api.stop();
});
