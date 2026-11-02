const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

async function moduleUnderTest() {
  return import(pathToFileURL(path.join(__dirname, "..", "src", "conversation-picker.mjs")).href);
}

test("conversation picker renders Codex groups as native checkbox rows", async () => {
  const { renderConversationPicker } = await moduleUnderTest();
  const html = renderConversationPicker({
    archivedIncluded: false,
    total: 3,
    groups: [
      { id: "pinned", kind: "pinned", label: "置顶", items: [{ id: "thread-1", title: "Pinned <work>", preview: "First & latest", updatedAt: 100, selectable: true }] },
      { id: "project:p", kind: "project", label: "Project One", items: [{ id: "thread-2", title: "Project thread", preview: "", updatedAt: 90, selectable: true }] },
      { id: "loose", kind: "loose", label: "分散的对话", items: [{ id: "thread-3", title: "Loose", preview: "", updatedAt: 80, selectable: false }] },
    ],
  });

  assert.match(html, /data-conversation-group="pinned"/);
  assert.match(html, /data-conversation-group="project"/);
  assert.match(html, /data-conversation-group="loose"/);
  assert.match(html, /type="checkbox" name="threadIds" value="thread-1"/);
  assert.match(html, /Pinned &lt;work&gt;/);
  assert.match(html, /First &amp; latest/);
  assert.match(html, /value="thread-3" disabled/);
  assert.doesNotMatch(html, /select multiple|Ctrl|⌘/);
});

test("conversation picker has explicit loading, empty, and error states", async () => {
  const { renderConversationPicker, renderConversationPickerError, renderConversationPickerLoading } = await moduleUnderTest();
  assert.match(renderConversationPickerLoading(), /正在读取未归档对话/);
  assert.match(renderConversationPicker({ archivedIncluded: false, total: 0, groups: [] }), /没有找到可选择的未归档对话/);
  assert.match(renderConversationPickerError(new Error("boom <unsafe>")), /boom &lt;unsafe&gt;/);
});
