const templates = {
  blank: { label: "空白项目", goal: "明确项目目标并建立可验收任务。", techStack: [], constraints: [], tasks: [] },
  web: { label: "Web 应用", goal: "交付一个可验证、可部署的 Web 应用。", techStack: ["TypeScript", "Web"], constraints: ["先验证入口、构建和部署链路"], tasks: ["确认应用入口与本地运行命令", "建立最小可验收页面"] },
  library: { label: "库 / SDK", goal: "交付稳定、可测试、可发布的代码库。", techStack: ["TypeScript", "单元测试"], constraints: ["保持 API 向后兼容", "每项变更有测试证据"], tasks: ["盘点公共 API 与测试入口", "建立最小发布门禁"] },
  automation: { label: "自动化工具", goal: "把重复流程变成可恢复、可观测的本地工具。", techStack: ["Node.js", "脚本"], constraints: ["任务必须幂等", "失败可恢复且不丢数据"], tasks: ["确认输入/输出与恢复点", "加入边界和重试测试"] },
  research: { label: "研究 / 原型", goal: "用可复核证据验证关键假设并形成下一步。", techStack: ["实验记录", "证据索引"], constraints: ["区分事实、推论和待验证假设"], tasks: ["定义验证问题与成功标准", "记录第一轮证据"] },
};

function listTemplates() { return Object.entries(templates).map(([id, value]) => ({ id, ...value, tasks: value.tasks.slice() })); }

function applyProjectTemplate(state, projectId, templateId) {
  const machine = require("./state-machine.cjs");
  const project = machine.getProject(state, projectId);
  if (project.status === "archived") throw new Error("已归档项目不能套用模板，请先恢复项目");
  const template = templates[String(templateId || "blank")] || templates.blank;
  project.goal = template.goal;
  project.techStack = [...template.techStack];
  project.constraints = [...template.constraints];
  project.templateId = String(templateId || "blank");
  const existingTitles = new Set((project.tasks || []).map((task) => task.title));
  for (const title of template.tasks) if (!existingTitles.has(title)) machine.createTask(state, projectId, { title, workstream: "template", agent: "codex", sessionPolicy: "auto" });
  project.events.unshift({ id: require("node:crypto").randomUUID(), type: "project.template.applied", at: new Date().toISOString(), detail: template.label });
  project.updatedAt = new Date().toISOString();
  return project;
}

module.exports = { templates, listTemplates, applyProjectTemplate };
