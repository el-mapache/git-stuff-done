'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { useEffect, useImperativeHandle, forwardRef, useRef, type MutableRefObject } from 'react';
import { CustomImage, imageDeleteRef, imageErrorRef, PLACEHOLDER_PREFIX } from '@/lib/customImage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMarkdown(editor: { storage: any }): string {
  return editor.storage.markdown.getMarkdown();
}

/** Upload an image file: insert placeholder → upload → replace with real URL (or remove on failure). */
function uploadAndInsert(
  file: File,
  upload: (file: File) => Promise<string>,
  editorRef: MutableRefObject<Editor | null>,
  pos?: number,
) {
  const editor = editorRef.current;
  if (!editor) return;

  const placeholderSrc = `${PLACEHOLDER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const placeholderContent = { type: 'image' as const, attrs: { src: placeholderSrc, alt: 'Uploading…' } };

  // Use Tiptap's insertContentAt which properly handles block insertion at any position
  if (pos != null) {
    // If dropping on an existing image (atomic block), insert after it instead
    const nodeAt = editor.state.doc.nodeAt(pos);
    const insertPos = nodeAt?.type.name === 'image' ? pos + nodeAt.nodeSize : pos;
    editor.chain().insertContentAt(insertPos, placeholderContent).run();
  } else {
    editor.chain().insertContent(placeholderContent).run();
  }

  upload(file)
    .then(url => {
      const ed = editorRef.current;
      if (!ed) return;
      // Find the placeholder node and replace its src with the real URL
      ed.state.doc.descendants((node, nodePos) => {
        if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
          ed.chain().setNodeSelection(nodePos).updateAttributes('image', { src: url, alt: '' }).run();
          return false;
        }
      });
    })
    .catch((err) => {
      console.error('Image upload failed:', err);
      const ed = editorRef.current;
      if (!ed) return;
      // Remove the placeholder node
      ed.state.doc.descendants((node, nodePos) => {
        if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
          const tr = ed.state.tr.delete(nodePos, nodePos + node.nodeSize);
          ed.view.dispatch(tr);
          return false;
        }
      });
      imageErrorRef.current?.(err instanceof Error ? err.message : 'Image upload failed');
    });
}

/** ProseMirror plugin that uploads dropped/pasted images and inserts them inline at the cursor. */
function createImageUploadPlugin(
  uploadRef: MutableRefObject<((file: File) => Promise<string>) | undefined>,
  editorRef: MutableRefObject<Editor | null>,
) {
  return new Plugin({
    props: {
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(f =>
          f.type.startsWith('image/'),
        );
        if (!files.length) return false;

        const upload = uploadRef.current;
        if (!upload) return false;

        event.preventDefault();

        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const dropPos = coords?.pos;

        for (const file of files) {
          uploadAndInsert(file, upload, editorRef, dropPos);
        }

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
          uploadAndInsert(file, upload, editorRef);
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
  onDeleteImage?: (url: string) => Promise<void>;
  onUploadError?: (msg: string) => void;
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  ({ content, onUpdate, placeholder, onImageUpload, onDeleteImage, onUploadError }, ref) => {
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

    const uploadRef = useRef(onImageUpload);
    useEffect(() => { uploadRef.current = onImageUpload; }, [onImageUpload]);

    const onDeleteRef = useRef(onDeleteImage);
    useEffect(() => {
      onDeleteRef.current = onDeleteImage;
      imageDeleteRef.current = onDeleteImage
        ? async (url: string) => { if (onDeleteRef.current) await onDeleteRef.current(url); }
        : undefined;
    }, [onDeleteImage]);

    const onErrorRef = useRef(onUploadError);
    useEffect(() => {
      onErrorRef.current = onUploadError;
      imageErrorRef.current = (msg: string) => onErrorRef.current?.(msg);
    }, [onUploadError]);

    // Ref to the Tiptap editor instance — used by the upload plugin for proper content insertion
    const tiptapRef = useRef<Editor | null>(null);

    // Track whether we're doing an external content reset to avoid echoing it back
    const externalUpdateRef = useRef(false);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          dropcursor: {
            color: 'currentColor',
            width: 2,
            class: 'tiptap-drop-cursor',
          },
        }),
        CustomImage,
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
            return [createImageUploadPlugin(uploadRef, tiptapRef)];
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

    // Keep editor ref in sync
    useEffect(() => { tiptapRef.current = editor; }, [editor]);

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
