import assert from "node:assert/strict";
import test from "node:test";
import { auditDifferences } from "../../public/js/device-audit-format.js";

test("audit comparison shows changed public and private fields but not internal bookkeeping", () => {
    const changes = auditDifferences({
        before: { name: "Old", auditId: "old", lastSeen: "old", status: "online" },
        after: { name: "New", auditId: "new", lastSeen: "", status: "online" },
        privateBefore: { ip: "192.0.2.1" }, privateAfter: { ip: "192.0.2.2" }
    });
    assert.deepEqual(changes.map((item) => item.label), ["ชื่ออุปกรณ์", "IP Address"]);
    assert.equal(changes[1].before, "192.0.2.1");
});

test("audit comparison supports creation, deletion and images without interpreting HTML", () => {
    const device = { name: "<img onerror=unsafe>", galleryImages: ["device-images/id/photo"] };
    assert.equal(auditDifferences({ before: null, after: device })[0].after, device.name);
    const deleted = auditDifferences({ before: device, after: null });
    assert.equal(deleted[0].after, "-");
    assert.equal(deleted[1].before, "device-images/id/photo");
});
