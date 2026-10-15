export const OFFLINE_CHECKS_REQUIRED = 3;
export const OFFLINE_MIN_DURATION_MS = 10 * 60 * 1000;
export const MAX_CHECK_GAP_MS = 15 * 60 * 1000;

export function observeStatus(previous, { status, now, targetKey, incidentId }) {
  if (!["online", "offline"].includes(status) || !Number.isFinite(now)) {
    throw new Error("Invalid status observation");
  }

  const targetChanged = Boolean(previous && previous.targetKey !== targetKey);
  const sameTarget = previous && !targetChanged;
  const continuous = sameTarget && previous.status === "offline" &&
    !previous.observationInterrupted &&
    now > previous.lastObservedAt && now - previous.lastObservedAt <= MAX_CHECK_GAP_MS;
  const activeId = sameTarget ? previous.activeIncidentId : null;
  const offlineSince = status === "offline"
    ? ((continuous || activeId) ? previous.offlineSince : now)
    : null;
  const consecutiveOffline = status === "offline"
    ? (continuous ? previous.consecutiveOffline + 1 : 1)
    : 0;
  const state = {
    status,
    targetKey,
    lastObservedAt: now,
    offlineSince,
    consecutiveOffline,
    activeIncidentId: activeId || null,
    observationInterrupted: false
  };
  let incidentAction = null;

  if (targetChanged && previous.activeIncidentId) {
    incidentAction = { type: "close", id: previous.activeIncidentId, reason: "target_changed" };
  } else if (status === "online" && activeId) {
    incidentAction = { type: "resolve", id: activeId, reason: "online" };
    state.activeIncidentId = null;
  } else if (status === "offline" && !activeId &&
    consecutiveOffline >= OFFLINE_CHECKS_REQUIRED &&
    now - offlineSince >= OFFLINE_MIN_DURATION_MS) {
    if (!incidentId) {
      throw new Error("An incident ID is required");
    }
    incidentAction = { type: "open", id: incidentId, offlineSince };
    state.activeIncidentId = incidentId;
  }

  const changed = !previous || targetChanged || previous.status !== status;
  const transition = changed ? {
    fromStatus: sameTarget ? previous.status : null,
    toStatus: status,
    kind: !previous ? "baseline" : targetChanged ? "target_changed" : "status_changed"
  } : null;

  const observationGap = Boolean(previous && (previous.observationInterrupted ||
    now - previous.lastObservedAt > MAX_CHECK_GAP_MS));
  return { state, transition, incidentAction, observationGap };
}
