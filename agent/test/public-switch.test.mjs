import assert from "node:assert/strict";
import test from "node:test";
import { publicSwitchData } from "../../public/js/switch/publicSwitch.js";

test("new public devices do not invent a successful Ping timestamp", () => {
  const data = publicSwitchData({ brand: "Zyxel", model: "GS1920", status: "offline" });
  assert.equal(data.lastSeen, "");
  assert.deepEqual(Object.keys(data).sort(), ["brand", "lastSeen", "model", "status"]);
});

test("public data keeps an existing check timestamp and excludes private fields", () => {
  const lastSeen = { toMillis: () => 1000 };
  const result = publicSwitchData({ brand: "Zyxel", status: "online", lastSeen,
    ip: "10.0.0.1", location: "private", name: "private" });
  assert.equal(result.lastSeen, lastSeen);
  assert.equal(Object.hasOwn(result, "ip"), false);
  assert.equal(Object.hasOwn(result, "location"), false);
  assert.equal(Object.hasOwn(result, "name"), false);
});
