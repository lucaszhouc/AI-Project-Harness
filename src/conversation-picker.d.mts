export interface CodexConversationPickerItem {
  id: string;
  title: string;
  preview?: string;
  cwd?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  recencyAt?: number | string;
  selectable?: boolean;
}

export interface CodexConversationPickerGroup {
  id: string;
  kind: "pinned" | "project" | "loose";
  label: string;
  projectId?: string;
  rootPaths?: string[];
  items: CodexConversationPickerItem[];
}

export interface CodexConversationIndex {
  generatedAt?: string;
  archivedIncluded: false;
  total: number;
  groups: CodexConversationPickerGroup[];
  sidebarSource?: string;
}

export function renderConversationPickerLoading(): string;
export function renderConversationPickerError(error: unknown): string;
export function renderConversationPicker(index: CodexConversationIndex): string;
