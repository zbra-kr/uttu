'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { createLowlight, common } from 'lowlight';
import TiptapToolbar from './TiptapToolbar';

const lowlight = createLowlight(common);

interface Props {
  content?: object;
  onChange?: (json: object) => void;
  placeholder?: string;
}

export default function TiptapEditor({
  content,
  onChange,
  placeholder = '내용을 입력하세요...',
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Image,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content ?? {},
    editable: true,
    immediatelyRender: false,
    onUpdate({ editor: e }) {
      onChange?.(e.getJSON());
    },
  });

  return (
    <div style={{
      border: '1px solid var(--bd)',
      borderRadius: 'var(--r-2)',
      overflow: 'hidden',
      background: 'var(--sur)',
    }}>
      {editor && <TiptapToolbar editor={editor} />}
      <div style={{
        padding: '12px 16px',
        minHeight: 240,
        color: 'var(--f1)',
        fontFamily: 'var(--sans)',
        fontSize: 'var(--fs-md)',
        lineHeight: 1.75,
      }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
