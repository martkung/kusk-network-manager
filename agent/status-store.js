import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { observeStatus } from "./status-policy.js";

function timestamp(value) {
  return value == null ? null : Timestamp.fromMillis(value);
}

function previousState(data) {
  return data ? {
    ...data,
    lastObservedAt: data.lastObservedAt.toMillis(),
    offlineSince: data.offlineSince?.toMillis() ?? null
  } : null;
}

function identity(deviceId, data) {
  return {
    deviceId,
    deviceName: typeof data.name === "string" ? data.name : deviceId,
    brand: typeof data.brand === "string" ? data.brand : "",
    model: typeof data.model === "string" ? data.model : "",
    location: typeof data.location === "string" ? data.location : ""
  };
}

export async function recordObservation(db, { deviceId, host, status }) {
  const deviceRef = db.collection("switches").doc(deviceId);
  const privateRef = db.collection("switchPrivate").doc(deviceId);
  const stateRef = db.collection("monitoringState").doc(deviceId);
  const historyRef = db.collection("statusHistory").doc();
  const newIncidentRef = db.collection("networkIncidents").doc();
  const targetKey = createHash("sha256").update(host).digest("hex");

  return db.runTransaction(async (transaction) => {
    const [device, privateDevice, tracking] = await transaction.getAll(deviceRef, privateRef, stateRef);
    if (!device.exists || !privateDevice.exists || privateDevice.data().ip !== host) {
      return false;
    }

    const previous = previousState(tracking.data());
    const currentIncident = previous?.activeIncidentId
      ? await transaction.get(db.collection("networkIncidents").doc(previous.activeIncidentId))
      : null;
    const observedAt = device.readTime;
    const result = observeStatus(previous, {
      status,
      now: observedAt.toMillis(),
      targetKey,
      incidentId: newIncidentRef.id
    });
    const deviceIdentity = identity(deviceId, device.data());

    transaction.update(deviceRef, { status, lastSeen: observedAt });
    transaction.set(db.collection("publicSwitches").doc(deviceId), {
      brand: deviceIdentity.brand,
      model: deviceIdentity.model,
      status,
      lastSeen: observedAt
    });
    transaction.set(stateRef, {
      ...deviceIdentity,
      ...result.state,
      lastObservedAt: observedAt,
      offlineSince: timestamp(result.state.offlineSince)
    });

    if (result.transition) {
      transaction.create(historyRef, {
        ...deviceIdentity,
        ...result.transition,
        observedAt
      });
    }

    const action = result.incidentAction;
    if (action?.type === "open") {
      transaction.create(newIncidentRef, {
        ...deviceIdentity,
        status: "open",
        offlineSince: timestamp(action.offlineSince),
        openedAt: observedAt,
        lastObservedAt: observedAt,
        resolvedAt: null,
        resolution: "",
        acknowledgedAt: null,
        acknowledgedBy: "",
        hasObservationGap: false
      });
    } else if (currentIncident?.exists && action) {
      transaction.update(currentIncident.ref, {
        status: action.type === "resolve" ? "resolved" : "closed",
        resolvedAt: observedAt,
        ...(action.type === "resolve" ? { lastObservedAt: observedAt } : {}),
        resolution: action.reason,
        hasObservationGap: Boolean(currentIncident.data().hasObservationGap || result.observationGap)
      });
    } else if (currentIncident?.exists && status === "offline") {
      transaction.update(currentIncident.ref, {
        lastObservedAt: observedAt,
        hasObservationGap: Boolean(currentIncident.data().hasObservationGap || result.observationGap)
      });
    }

    return true;
  });
}

export async function reconcileRemovedDevices(db, devices) {
  const tracking = await db.collection("monitoringState").get();
  for (const record of tracking.docs) {
    if (devices.has(record.id)) {
      continue;
    }

    const historyRef = db.collection("statusHistory").doc();
    await db.runTransaction(async (transaction) => {
      const [device, state] = await transaction.getAll(
        db.collection("switches").doc(record.id), record.ref
      );
      if (device.exists || !state.exists) {
        return;
      }
      const data = state.data();
      const incident = data.activeIncidentId
        ? await transaction.get(db.collection("networkIncidents").doc(data.activeIncidentId))
        : null;
      if (incident?.exists) {
        transaction.update(incident.ref, {
          status: "closed",
          resolution: "device_removed",
          resolvedAt: device.readTime
        });
      }
      transaction.create(historyRef, {
        ...identity(record.id, {
          name: data.deviceName, brand: data.brand, model: data.model, location: data.location
        }),
        fromStatus: data.status,
        toStatus: "removed",
        kind: "device_removed",
        observedAt: device.readTime
      });
      transaction.delete(record.ref);
    });
  }
}

export async function interruptObservation(db, deviceId) {
  const reference = db.collection("monitoringState").doc(deviceId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      transaction.update(reference, { observationInterrupted: true });
    }
  });
}
