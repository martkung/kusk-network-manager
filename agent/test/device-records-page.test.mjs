import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import * as auditFormat from "../../public/js/device-audit-format.js";
import { formatMonitoringTime } from "../../public/js/monitoring-format.js";

const source = await readFile(new URL("../../public/js/device-records.js", import.meta.url), "utf8");
const time = { toMillis: () => 100000 };
const deleted = { id: "device-a", data: () => ({ deviceId: "device-a", device: { name: "Device A", location: "Room" },
    privateDevice: { ip: "192.0.2.1", mac: "", serialNumber: "" }, deletedAt: time, deletedBy: "editor", reason: "Repair" }) };
const snapshot = (docs, fromCache = false) => ({ docs, size: docs.length, metadata: { fromCache } });

async function fixture(role = "editor", search = "?tab=trash") {
    class Element {
        children = []; listeners = new Map(); attributes = new Map(); textContent = ""; hidden = false; disabled = false; value = "";
        append(...items) { this.children.push(...items); }
        appendChild(item) { this.children.push(item); return item; }
        replaceChildren(...items) { this.children = items.flatMap((item) => item.fragment ? item.children : [item]); }
        setAttribute(key, value) { this.attributes.set(key, value); }
        addEventListener(key, callback) { this.listeners.set(key, callback); }
        trigger(key, event = {}) { return this.listeners.get(key)?.(event); }
        focus() {}
    }
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) { elements.set(id, new Element()); }
        return elements.get(id);
    };
    const subscriptions = [];
    const reads = [];
    const changes = [];
    const events = new Map();
    let privateDocs = [];
    const sandbox = createContext({ console: { error() {} }, Error, Map, String, URLSearchParams,
        navigator: { onLine: true }, confirm: () => true,
        window: { location: { search }, lucide: { createIcons() {} }, addEventListener: (key, callback) => events.set(key, callback) },
        document: { getElementById: element, createElement: () => new Element(),
            createDocumentFragment: () => Object.assign(new Element(), { fragment: true }) }
    });
    const synthetic = (exports) => new SyntheticModule(Object.keys(exports), function () {
        Object.entries(exports).forEach(([key, value]) => this.setExport(key, value));
    }, { context: sandbox });
    const module = new SourceTextModule(source, { context: sandbox });
    await module.link((specifier) => {
        if (specifier.includes("firebase-config")) { return synthetic({ db: {} }); }
        if (specifier.includes("permissions")) { return synthetic({ canManageUsers: (value) => ["owner", "admin"].includes(value),
            requireDeviceEditor: async () => {
                if (!["owner", "admin", "editor"].includes(role)) { throw new Error("permission denied"); }
                return { role, user: { uid: role } };
            } }); }
        if (specifier.includes("device-store")) { return synthetic({ changeDevice: async (...args) => { changes.push(args); } }); }
        if (specifier.includes("device-audit-format")) { return synthetic(auditFormat); }
        if (specifier.includes("monitoring-format")) { return synthetic({ formatMonitoringTime }); }
        return synthetic({
            collection: (_db, path) => ({ path }), where: (...args) => ({ type: "where", args }),
            orderBy: (...args) => ({ type: "orderBy", args }), limit: (count) => ({ type: "limit", count }),
            query: (base, ...constraints) => ({ ...base, constraints }),
            getDocs: async (request) => { reads.push(request); return snapshot(request.path === "switchPrivate" ? privateDocs : []); },
            onSnapshot: (request, options, callback, onError) => {
                const subscription = { request, callback, onError, active: true };
                subscriptions.push(subscription);
                return () => { subscription.active = false; };
            }
        });
    });
    await module.evaluate();
    return { element, subscriptions, reads, changes, sandbox, events,
        list: () => subscriptions.filter((item) => item.active).at(-1),
        setPrivate: (docs) => { privateDocs = docs; } };
}

test("editor can inspect trash without receiving a restore button", async () => {
    const setup = await fixture();
    setup.list().callback(snapshot([deleted]));
    assert.equal(setup.element("trashRows").children[0].children[4].textContent, "รอผู้ดูแลกู้คืน");
    assert.equal(setup.changes.length, 0);
});

test("manager restores the selected ID and disabled buttons protect cached and offline data", async () => {
    const setup = await fixture("admin");
    setup.list().callback(snapshot([deleted], true));
    assert.equal(setup.element("trashRows").children[0].children[4].children[0].disabled, true);
    setup.list().callback(snapshot([deleted]));
    const button = setup.element("trashRows").children[0].children[4].children[0];
    assert.equal(button.disabled, false);
    await button.trigger("click");
    assert.deepEqual(Array.from(setup.changes[0]), ["restore", "device-a"]);
    assert.equal(setup.element("recordsSuccess").hidden, false);
    setup.sandbox.navigator.onLine = false;
    setup.events.get("offline")();
    assert.equal(setup.element("trashRows").children[0].children[4].children[0].disabled, true);
});

test("restore stops when active network identity conflicts with the archived device", async () => {
    const setup = await fixture("owner");
    setup.setPrivate([{ data: () => ({ ip: "192.0.2.1" }) }]);
    setup.list().callback(snapshot([deleted]));
    await setup.element("trashRows").children[0].children[4].children[0].trigger("click");
    assert.equal(setup.changes.length, 0);
    assert.equal(setup.element("recordsError").hidden, false);
});

test("filter changes discard old rows, limits and late listener results", async () => {
    const setup = await fixture("admin");
    setup.list().callback(snapshot(Array.from({ length: 50 }, (_, i) => ({ ...deleted, id: "device-" + i }))));
    await setup.element("recordsMore").trigger("click");
    const previous = setup.list();
    assert.equal(previous.request.constraints.at(-1).count, 100);
    setup.element("recordsDevice").value = "device-b";
    await setup.element("recordsDevice").trigger("change");
    assert.equal(setup.list().request.constraints.at(-1).count, 50);
    previous.callback(snapshot([deleted]));
    assert.equal(setup.element("trashRows").children[0].children[0].textContent, "กำลังโหลดข้อมูล...");
    setup.list().callback(snapshot([]));
    assert.equal(setup.element("recordsMore").hidden, true);
});

test("permission failure clears previous rows and restore controls", async () => {
    const setup = await fixture("admin");
    setup.list().callback(snapshot([deleted]));
    setup.list().onError(new Error("permission-denied"));
    const row = setup.element("trashRows").children[0];
    assert.equal(row.children.length, 1);
    assert.equal(row.children[0].textContent, "โหลดข้อมูลไม่สำเร็จ");
    assert.equal(setup.element("recordsMore").hidden, true);
});

test("viewer is rejected before subscribing to or reading audit and trash data", async () => {
    await assert.rejects(fixture("viewer"), /permission denied/);
});
