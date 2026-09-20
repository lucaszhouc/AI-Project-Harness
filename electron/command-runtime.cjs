const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function selectExecutableCandidate(output, platform = process.platform) {
  const matches = String(output || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (platform !== "win32") return matches[0] || "";
  return matches.find((entry) => /\.(?:exe|com)$/i.test(entry))
    || matches.find((entry) => /\.(?:cmd|bat)$/i.test(entry))
    || matches[0]
    || "";
}

async function detectCommand(command, { platform = process.platform, run = execFileAsync } = {}) {
  try {
    const locator = platform === "win32" ? "where.exe" : "which";
    const { stdout } = await run(locator, [command], {
      timeout: 3000,
      windowsHide: true,
      encoding: "utf8",
    });
    const executable = selectExecutableCandidate(stdout, platform);
    return executable ? { installed: true, path: executable } : { installed: false, path: "" };
  } catch {
    return { installed: false, path: "" };
  }
}

function resolveCommandInvocation(
  executable,
  args,
  {
    platform = process.platform,
    environment = process.env,
    commandInterpreter = environment.ComSpec || process.env.ComSpec || "cmd.exe",
  } = {},
) {
  if (typeof executable !== "string" || !executable.trim()) {
    throw new TypeError("executable must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("command arguments must be an array of strings");
  }
  if ([executable, ...args].some((value) => value.includes("\0"))) {
    throw new TypeError("command values cannot contain null bytes");
  }

  const isWindowsShim = platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  if (!isWindowsShim) {
    return {
      executable,
      args,
      env: environment,
      wrapped: false,
      windowsVerbatimArguments: false,
    };
  }

  if ([executable, ...args].some((value) => /["\r\n]/.test(value))) {
    throw new TypeError("CMD/BAT arguments cannot contain quotes or line breaks");
  }

  const env = { ...environment, APH_COMMAND_EXECUTABLE: executable };
  const variables = args.map((argument, index) => {
    const name = `APH_COMMAND_ARG_${index}`;
    env[name] = argument;
    return `%${name}%`;
  });
  const command = `"${["%APH_COMMAND_EXECUTABLE%", ...variables].map((value) => `"${value}"`).join(" ")}"`;
  return {
    executable: commandInterpreter,
    args: ["/d", "/v:off", "/s", "/c", command],
    env,
    wrapped: true,
    windowsVerbatimArguments: true,
  };
}

module.exports = { detectCommand, resolveCommandInvocation, selectExecutableCandidate };
