const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveCommandInvocation } = require("../electron/command-runtime.cjs");

test("Windows development launchers use the shared command runtime for cmd shims", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "dev.mjs"), "utf8");

  assert.match(source, /command-runtime\.cjs/);
  assert.match(source, /resolveCommandInvocation/);
  assert.doesNotMatch(source, /spawn\(npmCommand/);
  assert.doesNotMatch(source, /spawn\(electronCommand/);
});

test("shared command runtime rejects empty executables before reaching spawn", () => {
  assert.throws(
    () => resolveCommandInvocation("", [], { platform: "win32", environment: {} }),
    /executable must be a non-empty string/,
  );
});

test("shared command runtime rejects quote and line-break injection in cmd shim arguments", () => {
  for (const unsafe of ['project"break', "line\nbreak", "line\rbreak"]) {
    assert.throws(
      () => resolveCommandInvocation("C:\\tools\\agent.cmd", [unsafe], {
        platform: "win32",
        environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      }),
      /CMD\/BAT arguments cannot contain quotes or line breaks/,
      unsafe,
    );
  }
});

test("native executable arguments remain literal and bypass the command interpreter", () => {
  const environment = { SAMPLE: "1" };
  const invocation = resolveCommandInvocation("C:\\tools\\agent.exe", ['literal"argument'], {
    platform: "win32",
    environment,
  });

  assert.deepEqual(invocation, {
    executable: "C:\\tools\\agent.exe",
    args: ['literal"argument'],
    env: environment,
    wrapped: false,
    windowsVerbatimArguments: false,
  });
});
