'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { Plugin } from '@tiptap/pm/state';
import { useEffect, useImperativeHandle, forwardRef, useRef } from 'react';

// Inserts a trailing space after any paste so the cursor escapes the link node.
const TrailingSpaceAfterPaste = Extension.create({
  name: 'trailingSpaceAfterPaste',
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        props: {
          handlePaste: () => {
            setTimeout(() => {
              ext.editor.chain().focus().insertContent(' ').run();
            }, 0);
            return false;
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

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  ({ content, onUpdate, placeholder }, ref) => {
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
    // Track whether we're doing an external content reset to avoid echoing it back
    const externalUpdateRef = useRef(false);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        }),
        Placeholder.configure({
          placeholder: placeholder ?? 'Start typing...',
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown.configure({
          tightLists: true,
          linkify: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
        TrailingSpaceAfterPaste,
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

    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        if (!editor) return;
        const textWithSpace = /\s$/.test(text) ? text : text + ' ';
        editor.chain().focus().insertContent(textWithSpace).run();
      },
    }), [editor]);

    return (
      <EditorContent
        editor={editor}
        className="tiptap-editor flex-1 w-full overflow-auto"
      />
    );
  }
);

TiptapEditor.displayName = 'TiptapEditor';
export default TiptapEditor;
