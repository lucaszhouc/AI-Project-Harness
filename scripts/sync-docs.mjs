#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicStatus = {
  en: `<!-- APH_AUTO_STATUS_START -->\n- Package version: v${pkg.version}\n- Release status: local candidate; no public release is implied.\n- Project names and host state are intentionally excluded.\n<!-- APH_AUTO_STATUS_END -->`,
  "zh-CN": `<!-- APH_AUTO_STATUS_START -->\n- 包版本：v${pkg.version}\n- 发布状态：本地候选；不表示已经公开发布。\n- 有意排除本机项目名称和宿主状态。\n<!-- APH_AUTO_STATUS_END -->`,
};

function replaceOrAppend(filePath, fallbackNeedle, block) {
  const text = fs.readFileSync(filePath, "utf8");
  const pattern = /<!-- APH_AUTO_STATUS_START -->[\s\S]*?<!-- APH_AUTO_STATUS_END -->/;
  const updated = pattern.test(text) ? text.replace(pattern, block) : text.replace(fallbackNeedle, `${fallbackNeedle}\n\n${block}`);
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, updated, "utf8");
  fs.renameSync(temporary, filePath);
}

replaceOrAppend(path.join(root, "README.md"), "## Release status", publicStatus.en);
replaceOrAppend(path.join(root, "README.zh-CN.md"), "## 发布状态", publicStatus["zh-CN"]);
process.stdout.write(`${JSON.stringify({ version: pkg.version, synced: ["README.md", "README.zh-CN.md"], privacy: "host-state-excluded" })}\n`);
