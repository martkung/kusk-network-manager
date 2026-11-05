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
    attributes = {};
    text = "";
    get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this.text; }
    set textContent(value) { this.text = String(value); this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    replaceChildren(...children) { this.children = children; this.text = ""; }
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

test("fresh device statuses use green for online and red for offline without a stale warning", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  const badge = new setup.Element();
  setup.updateStatus(badge, "online", setup.now);
  assert.equal(badge.dataset.freshness, "fresh");
  assert.match(badge.children[0].className, /bg-success/);
  assert.equal(badge.textContent, "online");
  setup.updateStatus(badge, "offline", setup.now);
  assert.match(badge.children[0].className, /bg-danger/);
  assert.equal(badge.children.length, 1);
  assert.equal(badge.textContent, "offline");
  assert.doesNotMatch(badge.title, /ข้อมูลเก่า/);
  setup.api.stop();
});

test("stale statuses retain distinct last-known colors alongside a separate amber warning", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  const badge = new setup.Element();
  for (const status of ["online", "offline"]) {
    setup.updateStatus(badge, status, setup.now - states.DEVICE_STALE_MS);
    assert.equal(badge.dataset.freshness, "stale");
    assert.equal(badge.children.length, 2);
    assert.equal(badge.children[0].textContent, status);
    assert.match(badge.children[0].className, new RegExp("device-status-" + status));
    assert.match(badge.children[0].className, /device-status-last-known/);
    assert.doesNotMatch(badge.children[0].className, /bg-success|bg-danger/);
    assert.match(badge.children[1].className, /bg-warning/);
    assert.equal(badge.children[1].textContent, "ข้อมูลเก่า");
    assert.match(badge.title, /ไม่ยืนยันสถานะปัจจุบัน/);
    assert.match(badge.getAttribute("aria-label"), /ผลตรวจล่าสุดที่บันทึกไว้/);
  }
  setup.api.stop();
});

test("unknown and future check times never present a last-known result as current", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  const badge = new setup.Element();
  for (const time of [null, undefined, "invalid", setup.now + 120000]) {
    setup.updateStatus(badge, "online", time);
    assert.equal(badge.dataset.freshness, "stale");
    assert.equal(badge.children[1].textContent, "ข้อมูลเก่า");
    assert.match(badge.getAttribute("aria-label"), /ไม่ยืนยันสถานะปัจจุบัน/);
  }
  setup.api.stop();
});

test("status refresh replaces old badges and clears the stale warning only after a fresh check", async () => {
  const setup = await fixture({ user: null, role: "guest" });
  const badge = new setup.Element();
  setup.updateStatus(badge, "online", setup.now - states.DEVICE_STALE_MS + 1);
  assert.equal(badge.children.length, 1);
  setup.updateStatus(badge, "online", setup.now - states.DEVICE_STALE_MS);
  assert.equal(badge.children.length, 2);
  setup.updateStatus(badge, "online", setup.now - states.DEVICE_STALE_MS);
  assert.equal(badge.children.length, 2);
  setup.updateStatus(badge, "offline", setup.now);
  assert.equal(badge.children.length, 1);
  assert.match(badge.children[0].className, /bg-danger/);
  assert.doesNotMatch(badge.getAttribute("aria-label"), /ข้อมูลเก่า|ผลตรวจล่าสุดที่บันทึกไว้/);
  setup.api.stop();
});
