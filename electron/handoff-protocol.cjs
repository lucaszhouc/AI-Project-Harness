/** A short pointer to bundled protocol files, never their full contents. */
function harnessProtocolReference(paths = {}) {
  const entries = [
    ["任务协议", paths.taskSkillPath || paths.skillPath],
    ["回写协议", paths.writebackSkillPath],
    ["状态字段", paths.taskStatusSchemaPath],
    ["导入字段", paths.importSchemaPath || paths.schemaPath],
  ].filter(([, target]) => String(target || "").trim());
  if (!entries.length) return "";
  return ["请先读取 Harness 内置交接协议：", ...entries.map(([label, target]) => `${label}：${String(target).trim()}`),
  ].join("\n");
}
module.exports = { harnessProtocolReference };
