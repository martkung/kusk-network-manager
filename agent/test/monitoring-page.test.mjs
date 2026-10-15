import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import * as formats from "../../public/js/monitoring-format.js";

const source = await readFile(new URL("../../public/js/monitoring.js", import.meta.url), "utf8");
function record(id, data) { return { id, data: () => data }; }
function snapshot(docs, fromCache = false) { return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache } }; }
const time = { toMillis: () => Date.parse("2026-10-12T03:00:00Z") };

async function fixture(role = "viewer") {
    class Element {
        children = [];
        hidden = false;
        disabled = false;
        value = "";
        dataset = {};
        listeners = new Map();
        attributes = new Map();
        textContent = "";
        setAttribute(key, value) { this.attributes.set(key, value); }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); return child; }
        replaceChildren(...children) {
            this.children = children.flatMap((child) => child.fragment ? child.children : [child]);
        }
        addEventListener(name, callback) { this.listeners.set(name, callback); }
        focus() {}
        trigger(name, event = {}) { return this.listeners.get(name)?.(event); }
    }
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) { elements.set(id, new Element()); }
        return elements.get(id);
    };
    element("incidentStatus").value = "open";
    const subscriptions = [];
    const writes = [];
    const reads = [];
    let olderHistory = [];
    const sandbox = createContext({
        console, URLSearchParams, Date, Map,
        navigator: { onLine: true },
        window: { location: { search: "" }, addEventListener() {} },
        document: {
            getElementById: element,
            createElement: () => new Element(),
            createDocumentFragment: () => Object.assign(new Element(), { fragment: true })
        }
    });
    function synthetic(exports) {
        return new SyntheticModule(Object.keys(exports), function () {
            Object.entries(exports).forEach(([key, value]) => this.setExport(key, value));
        }, { context: sandbox });
    }
    const module = new SourceTextModule(source, { context: sandbox });
    await module.link((specifier) => {
        if (specifier.startsWith("./firebase-config")) { return synthetic({ db: {} }); }
        if (specifier.startsWith("./permissions")) {
            return synthetic({ canEditDevices: (value) => ["owner", "admin", "editor"].includes(value),
                requireInventoryAccess: async () => ({ role, user: { uid: "actor" } }) });
        }
        if (specifier === "./agent-health.js") { return synthetic({ createAgentHealthNotice: () => ({ stop() {} }) }); }
        if (specifier === "./monitoring-format.js") { return synthetic(formats); }
        return synthetic({
            collection: (_db, path) => ({ path }),
            doc: (_db, path, id) => ({ path: path + "/" + id }),
            where: (...args) => ({ type: "where", args }),
            orderBy: (...args) => ({ type: "orderBy", args }),
            limit: (value) => ({ type: "limit", value }),
            startAfter: (cursor) => { assert.ok(cursor); return { type: "cursor", cursor }; },
            query: (base, ...constraints) => ({ ...base, constraints: [...(base.constraints || []), ...constraints] }),
            getDocs: async (request) => {
                reads.push(request);
                return request.path === "switches"
                    ? snapshot([record("device-a", { name: "Device A" })])
                    : snapshot(olderHistory);
            },
            onSnapshot: (request, options, callback, onError) => {
                if (typeof options === "function") { onError = callback; callback = options; }
                const subscription = { request, callback, onError, active: true };
                subscriptions.push(subscription);
                return () => { subscription.active = false; };
            },
            serverTimestamp: () => "SERVER_TIME",
            updateDoc: async (ref, fields) => { writes.push({ ref, fields }); }
        });
    });
    await module.evaluate();
    return { element, subscriptions, writes, reads, setOlder: (docs) => { olderHistory = docs; },
        list: () => subscriptions.filter((item) => item.active).at(-1) };
}

test("viewer sees incidents without an acknowledgement control", async () => {
    const setup = await fixture("viewer");
    setup.list().callback(snapshot([record("incident-a", { deviceId: "device-a", deviceName: "Device A",
        status: "open", offlineSince: time, lastObservedAt: time, openedAt: time })]));
    const acknowledgement = setup.element("incidentsTable").children[0].children[5];
    assert.equal(acknowledgement.textContent, "ยังไม่รับทราบ");
    assert.equal(acknowledgement.children.length, 0);
    assert.equal(setup.writes.length, 0);
});

test("editor acknowledges only actor and server time, without modifying incident status", async () => {
    const setup = await fixture("editor");
    setup.list().callback(snapshot([record("incident-a", { deviceId: "device-a", status: "open",
        openedAt: time, offlineSince: time, lastObservedAt: time })]));
    const button = setup.element("incidentsTable").children[0].children[5].children[0];
    await button.trigger("click");
    assert.equal(setup.writes[0].ref.path, "networkIncidents/incident-a");
    assert.deepEqual(Object.keys(setup.writes[0].fields).sort(), ["acknowledgedAt", "acknowledgedBy"]);
    assert.equal(setup.writes[0].fields.acknowledgedBy, "actor");
    assert.equal(setup.writes[0].fields.acknowledgedAt, "SERVER_TIME");
});

test("history has its own query and paginates older records without duplication", async () => {
    const setup = await fixture();
    setup.element("historyTab").trigger("click");
    assert.equal(setup.list().request.path, "statusHistory");
    const first = Array.from({ length: 50 }, (_unused, index) => record("event-" + index, {
        deviceId: "device-a", deviceName: "Device A", observedAt: time,
        fromStatus: "online", toStatus: "offline", kind: "status_changed"
    }));
    setup.list().callback(snapshot(first));
    assert.equal(setup.element("loadMoreMonitoring").hidden, false);
    setup.setOlder([first[49], record("older-event", first[0].data())]);
    await setup.element("loadMoreMonitoring").trigger("click");
    assert.equal(setup.element("historyTable").children.length, 51);
    assert.equal(setup.element("loadMoreMonitoring").hidden, true);
});

test("changing a history filter resets the cursor, rows and load-more state", async () => {
    const setup = await fixture();
    setup.element("historyTab").trigger("click");
    setup.list().callback(snapshot(Array.from({ length: 50 }, (_unused, index) => record(String(index), {
        deviceId: "device-a", observedAt: time, toStatus: "online", kind: "baseline"
    }))));
    const oldSubscription = setup.list();
    setup.element("monitorDevice").value = "device-a";
    setup.element("monitorDevice").trigger("change");
    setup.list().callback(snapshot([]));
    assert.equal(setup.element("loadMoreMonitoring").hidden, true);
    oldSubscription.callback(snapshot([record("late", { observedAt: time })]));
    assert.equal(setup.element("historyTable").children.length, 1);
    assert.equal(setup.element("historyTable").children[0].children[0].textContent, "ยังไม่มีประวัติสถานะ");
});

test("resolved incidents leave the active view when the realtime snapshot changes", async () => {
    const setup = await fixture();
    setup.list().callback(snapshot([record("incident-a", { deviceId: "device-a", status: "open", openedAt: time })]));
    setup.list().callback(snapshot([]));
    assert.equal(setup.element("incidentsTable").children[0].children[0].textContent, "ไม่มีเหตุการณ์ในรายการนี้");
});

test("failed or denied listener clears prior data and actionable controls", async () => {
    const setup = await fixture("editor");
    setup.list().callback(snapshot([record("incident-a", { deviceId: "device-a", status: "open", openedAt: time })]));
    setup.list().onError(new Error("permission-denied"));
    const rows = setup.element("incidentsTable").children;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].children[0].textContent, "โหลดข้อมูลไม่สำเร็จ");
    assert.equal(rows[0].children.length, 1);
    assert.equal(setup.element("loadMoreMonitoring").hidden, true);
});
