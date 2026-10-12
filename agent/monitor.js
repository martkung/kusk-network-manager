export async function startMonitor({
  checkDevices,
  publishHealth,
  timestamp,
  onError = console.error,
  heartbeatIntervalMs = 60000,
  checkIntervalMs = 300000,
  schedule = setInterval,
  cancel = clearInterval
}) {
  let stopping = false;
  let heartbeatPromise;
  let checkPromise;

  async function publish(data) {
    try {
      await publishHealth({ ...data, lastAgentSeen: timestamp() });
    } catch (error) {
      onError("Unable to publish Agent health:", error);
    }
  }

  function heartbeat() {
    if (stopping || heartbeatPromise) {
      return heartbeatPromise;
    }

    heartbeatPromise = publish({}).finally(() => {
      heartbeatPromise = undefined;
    });
    return heartbeatPromise;
  }

  function runCheck() {
    if (stopping || checkPromise) {
      return checkPromise;
    }

    checkPromise = (async () => {
      await publish({ phase: "running", checkStartedAt: timestamp() });

      try {
        const result = await checkDevices(() => stopping);
        if (stopping) {
          return;
        }

        const successful = result.failed === 0 && result.skipped === 0 &&
          result.checked === result.total;

        await publish({
          phase: successful ? "idle" : "degraded",
          total: result.total,
          checked: result.checked,
          failed: result.failed,
          skipped: result.skipped,
          lastCheckCompletedAt: timestamp(),
          ...(successful ? { lastSuccessfulCheckAt: timestamp() } : {})
        });
      } catch (error) {
        onError("Device check failed:", error);
        if (!stopping) {
          await publish({ phase: "degraded" });
        }
      }
    })().finally(() => {
      checkPromise = undefined;
    });

    return checkPromise;
  }

  await publish({
    phase: "starting",
    startedAt: timestamp(),
    heartbeatIntervalSeconds: heartbeatIntervalMs / 1000,
    checkIntervalSeconds: checkIntervalMs / 1000
  });

  const heartbeatTimer = schedule(heartbeat, heartbeatIntervalMs);
  const checkTimer = schedule(runCheck, checkIntervalMs);
  void runCheck();

  return {
    heartbeat,
    runCheck,
    async stop() {
      stopping = true;
      cancel(heartbeatTimer);
      cancel(checkTimer);
      await Promise.all([heartbeatPromise, checkPromise]);
      await publish({ phase: "stopped" });
    }
  };
}
