'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { useEffect, useImperativeHandle, forwardRef, useRef, type MutableRefObject } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMarkdown(editor: { storage: any }): string {
  return editor.storage.markdown.getMarkdown();
}

/** ProseMirror plugin that intercepts image drops/pastes, uploads them, and prevents default handling. */
function createImageUploadPlugin(
  uploadRef: MutableRefObject<((file: File) => Promise<string>) | undefined>,
) {
  return new Plugin({
    props: {
      // Drops are handled by the container onDrop — this just prevents ProseMirror from misinterpreting image files
      handleDrop(_view, event, _slice, moved) {
        if (moved || !event.dataTransfer?.files.length) return false;
        const hasImages = Array.from(event.dataTransfer.files).some(f =>
          f.type.startsWith('image/'),
        );
        if (!hasImages) return false;
        // Don't preventDefault here — let it bubble to the container onDrop handler
        return true;
      },
      handlePaste(_view, event) {
        const upload = uploadRef.current;
        if (!upload) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageFiles = items
          .filter(i => i.type.startsWith('image/'))
          .map(i => i.getAsFile())
          .filter((f): f is File => f !== null);
        if (!imageFiles.length) return false;
        event.preventDefault();
        for (const file of imageFiles) {
          upload(file).catch(err => console.error('Image upload failed:', err));
        }
        return true;
      },
    },
  });
}

export interface TiptapEditorHandle {
  insertAtCursor: (text: string) => void;
}

interface TiptapEditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  ({ content, onUpdate, placeholder, onImageUpload }, ref) => {
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

    const uploadRef = useRef(onImageUpload);
    useEffect(() => { uploadRef.current = onImageUpload; }, [onImageUpload]);

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
        // eslint-disable-next-line react-hooks/refs -- refs are read at event time, not during render
        Extension.create({
          name: 'imageUpload',
          addProseMirrorPlugins() {
            return [createImageUploadPlugin(uploadRef)];
          },
        }),
        Markdown.configure({
          tightLists: true,
          linkify: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
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
        editor.chain().focus().insertContent(text).run();
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
