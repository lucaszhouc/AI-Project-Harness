function runStillOwnsThread(run, isProcessAlive = () => false) {
  if (!run) return false;
  if (["starting", "running"].includes(String(run.status || "").toLowerCase())) return true;
  const processId = Number(run.processId);
  return Number.isFinite(processId) && processId > 0 && Boolean(isProcessAlive(processId));
}

module.exports = { runStillOwnsThread };
