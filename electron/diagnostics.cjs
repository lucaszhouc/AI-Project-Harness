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
}

module.exports = { createDiagnostics, installProcessErrorLogging };
