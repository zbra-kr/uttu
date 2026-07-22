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
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { createLowlight, common } from 'lowlight';
import { OUTPUT_CLS, outputContainerStyle } from './helpStyles';

const lowlight = createLowlight(common);

interface Props {
  content: object | null;
  className?: string;
}

export default function TiptapRenderer({ content, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Image,
      Link.configure({ openOnClick: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content ?? {},
    editable: false,
    immediatelyRender: false,
  });

  return (
    <div
      className={className ? `${OUTPUT_CLS} ${className}` : OUTPUT_CLS}
      style={outputContainerStyle}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
