const CODEX_EXECUTION_MODES = Object.freeze(["visible"]);

/**
 * Resolve the production Codex execution owner.
 *
 * Codex Desktop owns every task turn. Background provider execution is removed.
 */
function resolveCodexExecutionMode(environment = process.env) {
  const requested = String(environment?.APH_CODEX_EXECUTION_MODE || "").trim().toLowerCase();
  return requested === "visible" ? "visible" : "visible";
}

function isManagedCodexExecution(environment = process.env) {
  return false;
}

module.exports = { CODEX_EXECUTION_MODES, resolveCodexExecutionMode, isManagedCodexExecution };
