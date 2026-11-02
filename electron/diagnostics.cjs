function createDiagnostics({ errorLog, showItemInFolder }) {
  function showErrorLog() {
    const filePath = errorLog.ensureFile();
    showItemInFolder(filePath);
    return { opened: true, path: filePath };
  }

  function reportRendererError(details = {}) {
    const message = String(details.message || "Renderer error").slice(0, 4000);
    const error = new Error(message);
    if (details.stack) error.stack = String(details.stack).slice(0, 20000);
    const record = errorLog.capture(error, {
      operation: "renderer",
      stage: String(details.stage || "unknown").slice(0, 80),
    });
    return { errorId: record.id };
  }

  return { showErrorLog, reportRendererError };
}

function installProcessErrorLogging({ processRef = process, errorLog }) {
  const captureWithoutThrowing = (error, details) => {
    try {
      errorLog.capture(error, details);
    } catch {
      // Diagnostics must never replace or recursively amplify the original process failure.
    }
  };
  processRef.on("uncaughtExceptionMonitor", (error, origin) => {
    captureWithoutThrowing(error, { operation: "main-process", stage: origin || "uncaughtException" });
  });
  processRef.on("unhandledRejection", (reason) => {
    captureWithoutThrowing(reason, { operation: "main-process", stage: "unhandledRejection" });
  });
  // Electron can report a renderer IPC reply through a pipe that has just
  // disconnected (for example, a CDP/renderer test closes while an async IPC
  // handler is returning). Node surfaces that write as an uncaught EPIPE from
  // Electron's internal `replyWithError`; allowing it to escape terminates the
  // Harness process and hides the original operation failure. The error is
  // already captured by `uncaughtExceptionMonitor`; swallow only this exact
  // broken-pipe boundary and preserve normal uncaught-exception behavior.
  processRef.on("uncaughtException", (error) => {
    if (String(error?.code || "") === "EPIPE" || /EPIPE: broken pipe/i.test(String(error?.message || error))) return;
    throw error;
  });
}

module.exports = { createDiagnostics, installProcessErrorLogging };
