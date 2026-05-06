import type { EditorView } from '@codemirror/view';

export type ToolbarAction = (view: EditorView, dispatch?: (open: 'table' | 'link') => void) => boolean;

export interface ToolbarItem {
  id: string;
  iconName: string;
  i18nKey: string;
  action: ToolbarAction;
  shortcut?: string;
  dividerAfter?: boolean;
}

function wrapSelection(view: EditorView, before: string, after: string = before): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selectedText = state.sliceDoc(from, to);

  if (selectedText.length === 0) {
    view.dispatch({
      changes: { from, insert: `${before}${after}` },
      selection: { anchor: from + before.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: `${before}${selectedText}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + selectedText.length },
    });
  }
  view.focus();
  return true;
}

function prefixLines(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  const changes: { from: number; insert: string }[] = [];
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i);
    changes.push({ from: line.from, insert: prefix });
  }

  view.dispatch({ changes });
  view.focus();
  return true;
}

function insertBlock(view: EditorView, block: string, cursorOffset: number): boolean {
  const { state } = view;
  const { from } = state.selection.main;

  const lineStart = state.doc.lineAt(from);
  const needsNewlineBefore = from > lineStart.from;
  const insertText = (needsNewlineBefore ? '\n' : '') + block;

  view.dispatch({
    changes: { from, insert: insertText },
    selection: { anchor: from + (needsNewlineBefore ? 1 : 0) + cursorOffset },
  });
  view.focus();
  return true;
}

export const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: 'bold',
    iconName: 'format_bold',
    i18nKey: 'markdownEditor.toolbar.bold',
    shortcut: 'Mod-b',
    action: (v) => wrapSelection(v, '**'),
  },
  {
    id: 'italic',
    iconName: 'format_italic',
    i18nKey: 'markdownEditor.toolbar.italic',
    shortcut: 'Mod-i',
    action: (v) => wrapSelection(v, '*'),
  },
  {
    id: 'code',
    iconName: 'code',
    i18nKey: 'markdownEditor.toolbar.inlineCode',
    shortcut: 'Mod-e',
    action: (v) => wrapSelection(v, '`'),
    dividerAfter: true,
  },
  {
    id: 'h1',
    iconName: 'format_h1',
    i18nKey: 'markdownEditor.toolbar.h1',
    action: (v) => prefixLines(v, '# '),
  },
  {
    id: 'h2',
    iconName: 'format_h2',
    i18nKey: 'markdownEditor.toolbar.h2',
    action: (v) => prefixLines(v, '## '),
  },
  {
    id: 'h3',
    iconName: 'format_h3',
    i18nKey: 'markdownEditor.toolbar.h3',
    action: (v) => prefixLines(v, '### '),
    dividerAfter: true,
  },
  {
    id: 'ul',
    iconName: 'format_list_bulleted',
    i18nKey: 'markdownEditor.toolbar.bulletList',
    action: (v) => prefixLines(v, '- '),
  },
  {
    id: 'ol',
    iconName: 'format_list_numbered',
    i18nKey: 'markdownEditor.toolbar.numberedList',
    action: (v) => prefixLines(v, '1. '),
  },
  {
    id: 'blockquote',
    iconName: 'format_quote',
    i18nKey: 'markdownEditor.toolbar.blockquote',
    action: (v) => prefixLines(v, '> '),
    dividerAfter: true,
  },
  {
    id: 'link',
    iconName: 'link',
    i18nKey: 'markdownEditor.toolbar.link',
    shortcut: 'Mod-k',
    action: (_v, dispatch) => {
      if (dispatch) dispatch('link');
      return true;
    },
  },
  {
    id: 'table',
    iconName: 'table_chart',
    i18nKey: 'markdownEditor.toolbar.table',
    action: (_v, dispatch) => {
      if (dispatch) dispatch('table');
      return true;
    },
  },
  {
    id: 'codeblock',
    iconName: 'data_object',
    i18nKey: 'markdownEditor.toolbar.codeBlock',
    action: (v) => insertBlock(v, '```\n\n```\n', 3),
  },
];

export function buildTable(rows: number, cols: number): string {
  const headerCells = Array.from({ length: cols }, (_, i) => `Header ${i + 1}`);
  const separatorCells = Array<string>(cols).fill('---');
  const dataRow = Array.from({ length: cols }, (_, i) => `Cell ${i + 1}`);

  const lines: string[] = [
    `| ${headerCells.join(' | ')} |`,
    `| ${separatorCells.join(' | ')} |`,
  ];
  for (let r = 0; r < rows; r++) {
    lines.push(`| ${dataRow.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function insertLink(view: EditorView, text: string, url: string): void {
  const { from } = view.state.selection.main;
  const linkText = text || url;
  view.dispatch({
    changes: { from, insert: `[${linkText}](${url})` },
    selection: { anchor: from + linkText.length + url.length + 4 },
  });
  view.focus();
}

export function insertTable(view: EditorView, rows: number, cols: number): void {
  const { from } = view.state.selection.main;
  const lineStart = view.state.doc.lineAt(from);
  const needsNewlineBefore = from > lineStart.from;
  const tableText = (needsNewlineBefore ? '\n\n' : '') + buildTable(rows, cols);

  view.dispatch({
    changes: { from, insert: tableText },
  });
  view.focus();
}
