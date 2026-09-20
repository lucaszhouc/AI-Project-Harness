const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath, fileSystem = fs) {
  try { return JSON.parse(fileSystem.readFileSync(filePath, "utf8")); } catch { return undefined; }
}

function inspectProjectProfile(projectPath, { fileSystem = fs } = {}) {
  const root = path.resolve(projectPath);
  const stack = [];
  const markers = [];
  const packageJson = readJson(path.join(root, "package.json"), fileSystem);
  if (packageJson) {
    stack.push("Node.js");
    if (packageJson.dependencies?.typescript || packageJson.devDependencies?.typescript) stack.push("TypeScript");
    if (packageJson.dependencies?.react || packageJson.devDependencies?.react) stack.push("React");
    if (packageJson.dependencies?.electron || packageJson.devDependencies?.electron) stack.push("Electron");
    markers.push("package.json");
  }
  const files = [
    ["pyproject.toml", "Python"], ["requirements.txt", "Python"], ["Cargo.toml", "Rust"], ["go.mod", "Go"], ["pom.xml", "Java"], ["composer.json", "PHP"],
  ];
  for (const [name, label] of files) {
    try { if (fileSystem.existsSync(path.join(root, name))) { stack.push(label); markers.push(name); } } catch {}
  }
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? Object.keys(packageJson.scripts).slice(0, 30) : [];
  const entrypoints = ["src/main.ts", "src/main.js", "src/index.ts", "src/index.js", "main.py", "app.py", "index.html", "Cargo.toml", "go.mod"]
    .filter((name) => { try { return fileSystem.existsSync(path.join(root, name)); } catch { return false; } });
  return {
    root,
    stack: [...new Set(stack)],
    markers,
    scripts,
    entrypoints,
    packageManager: packageJson?.packageManager || (fileSystem.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : fileSystem.existsSync(path.join(root, "yarn.lock")) ? "yarn" : packageJson ? "npm" : undefined),
    inspectedAt: new Date().toISOString(),
  };
}

module.exports = { inspectProjectProfile };
