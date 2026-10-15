import { changeDevice } from "./device-store.js";

export async function deleteSwitch(id, reason) {
    await changeDevice("delete", id, {}, reason);
}
