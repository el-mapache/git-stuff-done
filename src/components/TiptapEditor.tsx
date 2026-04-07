"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ListItem } from "@tiptap/extension-list-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import MentionList, {
  type MentionItem,
  type MentionListHandle,
} from "./MentionList";

// Inserts a trailing space after any paste so the cursor escapes the link node.
const TrailingSpaceAfterPaste = Extension.create({
  name: "trailingSpaceAfterPaste",
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        props: {
          handlePaste: () => {
            setTimeout(() => {
              ext.editor.chain().focus().insertContent(" ").run();
            }, 0);
            return false;
          },
        },
      }),
    ];
  },
});

const codeFenceRe = /^```([a-z]*)$/;

// Handles Enter on a line matching ```.
//  - If a matching opening ``` exists above → wraps intervening paragraphs into
//    a codeBlock (closing-fence behaviour).
//  - Otherwise → clears the backticks and converts the paragraph to an empty
//    codeBlock (opening-fence behaviour).
//
// Uses a high-priority ProseMirror plugin so it fires before the list-item
// Enter handler that would otherwise split the list item.
const CodeFenceShortcut = Extension.create({
  name: "codeFenceShortcut",
  priority: 200,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("codeFenceShortcut"),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== "Enter") return false;

            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false;

            const node = $from.parent;
            if (node.type.name !== "paragraph") return false;

            const text = node.textContent;
            const match = text.match(codeFenceRe);
            if (!match) return false;

            const parent = $from.node(-1);
            const myIndex = $from.index(-1);

            // Try closing-fence: search backward for an opening ```
            for (
              let i = myIndex - 1;
              i >= 0 && i >= myIndex - 100;
              i--
            ) {
              const sibling = parent.child(i);
              if (sibling.type.name !== "paragraph") break;
              const m = sibling.textContent.match(codeFenceRe);
              if (m) {
                // Found opening fence → collect content lines between fences
                const language = m[1] || "";
                const lines: string[] = [];
                for (let j = i + 1; j < myIndex; j++) {
                  lines.push(parent.child(j).textContent);
                }
                const codeContent = lines.join("\n");

                // Calculate document range spanning opening → closing paragraphs
                let rangeStart = $from.start(-1);
                for (let k = 0; k < i; k++)
                  rangeStart += parent.child(k).nodeSize;
                let rangeEnd = rangeStart;
                for (let k = i; k <= myIndex; k++)
                  rangeEnd += parent.child(k).nodeSize;

                const codeBlockNode =
                  state.schema.nodes.codeBlock.create(
                    { language: language || null },
                    codeContent
                      ? state.schema.text(codeContent)
                      : null,
                  );

                view.dispatch(
                  state.tr.replaceWith(
                    rangeStart,
                    rangeEnd,
                    codeBlockNode,
                  ),
                );
                return true;
              }
            }

            // No opening fence found → opening-fence: create empty code block
            const language = match[1] || "";
            const { tr } = state;
            const start = $from.start();
            const end = $from.end();
            if (end > start) tr.delete(start, end);
            tr.setBlockType(
              tr.mapping.map(start),
              tr.mapping.map(start),
              state.schema.nodes.codeBlock,
              { language: language || null },
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMarkdown(editor: { storage: any }): string {
  return editor.storage.markdown.getMarkdown();
}

export interface TiptapEditorHandle {
  insertAtCursor: (text: string) => void;
}

interface TiptapEditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  placeholder?: string;
}

let fetchController: AbortController | null = null;

async function fetchMentionItems(query: string): Promise<MentionItem[]> {
  // Cancel any previous in-flight request
  if (fetchController) fetchController.abort();
  if (!query) return [];

  const controller = new AbortController();
  fetchController = controller;

  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`/api/org-members?${params}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.members ?? [];
  } catch {
    // Aborted or network error
    return [];
  }
}

const CustomMention = Mention.extend({
  // Render mentions as bold linked text in the editor HTML
  renderHTML({ node, HTMLAttributes }) {
    const login = node.attrs.label ?? node.attrs.id;
    return [
      "a",
      {
        ...HTMLAttributes,
        href: `https://github.com/${login}`,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "mention-node",
        "data-type": "mention",
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
      },
      `@${login}`,
    ];
  },

  // Override markdown serialization via the tiptap-markdown storage hook
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void },
          node: { attrs: { id: string; label?: string } },
        ) {
          const login = node.attrs.label ?? node.attrs.id;
          state.write(`**[@${login}](https://github.com/${login})**`);
        },
        parse: {},
      },
    };
  },
});

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  ({ content, onUpdate, placeholder }, ref) => {
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => {
      onUpdateRef.current = onUpdate;
    }, [onUpdate]);
    // Track whether we're doing an external content reset to avoid echoing it back
    const externalUpdateRef = useRef(false);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ listItem: false }),
        ListItem.extend({ content: "(paragraph | codeBlock) block*" }),
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        }),
        Placeholder.configure({
          placeholder: placeholder ?? "Start typing...",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CustomMention.configure({
          HTMLAttributes: { class: "mention-node" },
          renderText({ node }) {
            return `@${node.attrs.label ?? node.attrs.id}`;
          },
          suggestion: {
            char: "@",
            allowSpaces: false,
            items: async ({ query }: { query: string }) => {
              return fetchMentionItems(query);
            },
            render: () => {
              let renderer: ReactRenderer<MentionListHandle> | null = null;
              let popup: HTMLDivElement | null = null;

              return {
                onStart(props) {
                  renderer = new ReactRenderer(MentionList, {
                    props: {
                      items: props.items,
                      query: props.query,
                      command: (item: MentionItem) => {
                        props.command({ id: item.login, label: item.login });
                      },
                    },
                    editor: props.editor,
                  });

                  popup = document.createElement("div");
                  popup.style.cssText = "position:fixed;z-index:9999;";
                  popup.appendChild(renderer.element);
                  document.body.appendChild(popup);

                  const rect = props.clientRect?.();
                  if (rect && popup) {
                    popup.style.left = `${rect.left}px`;
                    popup.style.top = `${rect.bottom + 4}px`;
                  }
                },
                onUpdate(props) {
                  renderer?.updateProps({
                    items: props.items,
                    query: props.query,
                    command: (item: MentionItem) => {
                      props.command({ id: item.login, label: item.login });
                    },
                  });

                  const rect = props.clientRect?.();
                  if (rect && popup) {
                    popup.style.left = `${rect.left}px`;
                    popup.style.top = `${rect.bottom + 4}px`;
                  }
                },
                onKeyDown(props) {
                  if (props.event.key === "Escape") {
                    popup?.remove();
                    popup = null;
                    renderer?.destroy();
                    renderer = null;
                    return true;
                  }
                  return renderer?.ref?.onKeyDown(props) ?? false;
                },
                onExit() {
                  popup?.remove();
                  popup = null;
                  renderer?.destroy();
                  renderer = null;
                },
              };
            },
          },
        }),
        Markdown.configure({
          tightLists: true,
          linkify: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
        TrailingSpaceAfterPaste,
        CodeFenceShortcut,
      ],
      content,
      onUpdate: ({ editor }) => {
        if (externalUpdateRef.current) return;
        const md = getMarkdown(editor);
        onUpdateRef.current(md);
      },
    });

    // Update editor when content prop changes externally (initial load, linkify)
    useEffect(() => {
      if (!editor) return;
      const currentMd = getMarkdown(editor);
      if (content !== currentMd) {
        externalUpdateRef.current = true;
        editor.commands.setContent(content);
        externalUpdateRef.current = false;
      }
    }, [content, editor]);

    useImperativeHandle(
      ref,
      () => ({
        insertAtCursor: (text: string) => {
          if (!editor) return;
          const textWithSpace = /\s$/.test(text) ? text : text + " ";
          editor.chain().focus().insertContent(textWithSpace).run();
        },
      }),
      [editor],
    );

    return (
      <EditorContent
        editor={editor}
        className="tiptap-editor flex-1 w-full overflow-auto"
      />
    );
  },
);

TiptapEditor.displayName = "TiptapEditor";
export default TiptapEditor;
