import { setTimeout as delay } from "node:timers/promises";

export function emulatorOrigin(host) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/.test(host || "")) {
    throw new Error("Restore requires a loopback-only Firebase emulator");
  }
  const url = new URL("http://" + host);
  if (!url.port || Number(url.port) > 65535) { throw new Error("Invalid emulator port"); }
  return url.origin;
}

export function firestoreClient({ projectId, accessToken, origin = "https://firestore.googleapis.com", fetchImpl = fetch }) {
  if (origin !== "https://firestore.googleapis.com") {
    emulatorOrigin(new URL(origin).host);
    if (!projectId.startsWith("demo-")) { throw new Error("Emulator project must use the demo- prefix"); }
  }
  const root = `projects/${projectId}/databases/(default)/documents`;
  async function request(resource, { method = "GET", body, query } = {}) {
    const encoded = resource.split("/").map(encodeURIComponent).join("/")
      .replace(/%3A(runQuery|listCollectionIds|commit)$/i, ":$1");
    const url = new URL(origin + "/v1/" + encoded);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== "") { url.searchParams.set(key, String(value)); }
    }
    for (let attempt = 0; ; attempt += 1) {
      const token = await accessToken();
      const response = await fetchImpl(url, { method, redirect: "error", signal: AbortSignal.timeout(60000),
        headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.ok) { return response.json(); }
      if (attempt < 3 && [429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await delay(500 * 2 ** attempt);
        continue;
      }
      let detail = "";
      if (origin !== "https://firestore.googleapis.com") {
        const error = await response.json().catch(() => ({}));
        detail = ": " + (error.error?.message || "unknown emulator error");
      }
      throw new Error("Firestore request failed (HTTP " + response.status + ")" + detail);
    }
  }

  async function snapshot() {
    const baseline = await request(root + ":runQuery", { method: "POST", body: {
      structuredQuery: { from: [{ collectionId: "switches" }], limit: 1 }
    } });
    const readTime = baseline.find((item) => item.readTime)?.readTime;
    if (!readTime || !Number.isFinite(Date.parse(readTime))) { throw new Error("Missing server snapshot time"); }
    // The emulator cannot serve historical REST list reads; production always pins every page to readTime.
    const consistency = origin === "https://firestore.googleapis.com" ? { readTime } : {};
    const documents = [];
    async function visit(parent, depth = 0) {
      if (depth > 100) { throw new Error("Firestore nesting exceeds safety limit"); }
      let collectionPage = "";
      do {
        const collections = await request(parent + ":listCollectionIds", { method: "POST",
          body: { pageSize: 1000, ...(collectionPage ? { pageToken: collectionPage } : {}), ...consistency } });
        for (const id of collections.collectionIds || []) {
          let documentPage = "";
          do {
            const page = await request(parent + "/" + id, { query: { pageSize: 500, pageToken: documentPage, showMissing: true, ...consistency } });
            for (const document of page.documents || []) {
              if (!document.name.startsWith(root + "/")) { throw new Error("Unexpected source document"); }
              if (document.createTime || document.updateTime) {
                documents.push({ path: document.name.slice(root.length + 1), fields: document.fields || {} });
                if (documents.length > 100000) { throw new Error("Backup exceeds document safety limit"); }
              }
              await visit(document.name, depth + 1);
            }
            documentPage = page.nextPageToken || "";
          } while (documentPage);
        }
        collectionPage = collections.nextPageToken || "";
      } while (collectionPage);
    }
    await visit(root);
    documents.sort((a, b) => a.path.localeCompare(b.path));
    return { readTime, documents };
  }

  return { root, request, snapshot, emulator: origin !== "https://firestore.googleapis.com" };
}
