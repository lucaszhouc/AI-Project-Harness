function keyFor(node) {
  if (!(node instanceof Element)) return "";
  if (node.id) return `${node.tagName}:id:${node.id}`;
  for (const name of ["data-preserve-key", "data-preserve-focus-key", "data-task", "data-project", "data-section", "data-session", "data-knowledge"]) {
    const value = node.getAttribute(name);
    if (value) return `${node.tagName}:${name}:${value}:${node.getAttribute("data-action") || ""}`;
  }
  return "";
}

function compatible(current, next) {
  return current.nodeType === next.nodeType && current.nodeName === next.nodeName && keyFor(current) === keyFor(next);
}

function reconcileNode(current, next) {
  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  if (!(current instanceof Element) || !(next instanceof Element)) return;
  if (current instanceof HTMLDialogElement && current.open) return;
  if (current.hasAttribute("data-operation-busy")) return;
  const wasOpen = current instanceof HTMLDetailsElement && current.open;
  for (const attribute of Array.from(current.attributes)) {
    if (!next.hasAttribute(attribute.name) && !(wasOpen && attribute.name === "open")) current.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(next.attributes)) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  reconcileChildren(current, next);
}

function reconcileChildren(current, next) {
  const previous = Array.from(current.childNodes);
  const used = new Set();
  let cursor = current.firstChild;
  for (const incoming of Array.from(next.childNodes)) {
    const key = keyFor(incoming);
    const existing = key
      ? previous.find(node => !used.has(node) && keyFor(node) === key && compatible(node, incoming))
      : cursor && !used.has(cursor) && compatible(cursor, incoming) ? cursor : undefined;
    const retained = existing || incoming.cloneNode(true);
    if (retained !== cursor) current.insertBefore(retained, cursor);
    if (existing) { used.add(existing); reconcileNode(existing, incoming); }
    cursor = retained.nextSibling;
  }
  for (const node of previous) if (!used.has(node) && node.parentNode === current) current.removeChild(node);
}

export function reconcileHtml(root, html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  reconcileChildren(root, template.content);
}
