const fs = require("node:fs");
const path = require("node:path");
const DESKTOP_NATIVE_CODEX = Object.freeze({
  installed: true,
  path: "",
  source: "desktop-native-protocol",
  native: true,
  cliDisabled: true,
});

function selectExecutableCandidate() {
  return "";
}

function findDesktopCodex() {
  return "";
}

/** Codex is controlled exclusively through the registered Desktop protocol. */
async function detectCommand(command) {
  if (command === "codex") return { ...DESKTOP_NATIVE_CODEX };
  return { installed: false, path: "", source: "disabled" };
}

function resolveCommandInvocation() {
  const error = new Error("CLI execution is disabled; use Desktop native APIs");
  error.code = "CLI_DISABLED";
  throw error;
}

module.exports = { detectCommand, findDesktopCodex, resolveCommandInvocation, selectExecutableCandidate };
