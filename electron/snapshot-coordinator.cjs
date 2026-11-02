function createSnapshotCoordinator(build) {
  let inFlight;
  let activeOptions;
  let queued;
  let queuedOptions;
  function snapshot(options = {}) {
    if (inFlight) {
      const needsUpgrade = ["forceGithub", "forceGit"].some(key => options[key] && !activeOptions[key]);
      if (!needsUpgrade) return inFlight;
      queuedOptions = { ...queuedOptions, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value)) };
      if (!queued) {
        queued = inFlight.catch(() => undefined).then(() => {
          const next = queuedOptions;
          queued = undefined;
          queuedOptions = undefined;
          return snapshot(next);
        });
      }
      return queued;
    }
    activeOptions = options;
    const current = Promise.resolve().then(() => build(options));
    inFlight = current;
    const release = () => { if (inFlight === current) { inFlight = undefined; activeOptions = undefined; } };
    current.then(release, release);
    return current;
  }
  return snapshot;
}

module.exports = { createSnapshotCoordinator };
