'use client';
import React, { useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
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
import { uploadHelpImage } from '@/lib/upload-help-image';

const lowlight = createLowlight(common);

// ── 툴바 ─────────────────────────────────────────────────────────────────────

function btnS(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px', borderRadius: 'var(--r-1)', border: 'none',
    cursor: 'pointer', fontSize: 'var(--fs-sm)', lineHeight: 1.6,
    fontWeight: active ? 700 : 400,
    background: active ? 'var(--snk)' : 'transparent',
    color: active ? 'var(--f1)' : 'var(--f3)',
    transition: 'background 100ms, color 100ms',
  };
}
const SEP: React.CSSProperties = {
  width: 1, background: 'var(--bd)', margin: '2px 4px', alignSelf: 'stretch',
};

interface ToolbarProps {
  editor: Editor;
  onImageClick: () => void;
  imgLoading: boolean;
}

function Toolbar({ editor, onImageClick, imgLoading }: ToolbarProps) {
  const r = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn(); };
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
      padding: '5px 8px', borderBottom: '1px solid var(--bd)', background: 'var(--bg)',
    }}>
      <button style={btnS(editor.isActive('bold'))}
        onMouseDown={r(() => editor.chain().focus().toggleBold().run())}>B</button>
      <button style={btnS(editor.isActive('italic'))}
        onMouseDown={r(() => editor.chain().focus().toggleItalic().run())}>I</button>
      <button style={btnS(editor.isActive('strike'))}
        onMouseDown={r(() => editor.chain().focus().toggleStrike().run())}>S</button>
      <span style={SEP} />
      <button style={btnS(editor.isActive('heading', { level: 1 }))}
        onMouseDown={r(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>H1</button>
      <button style={btnS(editor.isActive('heading', { level: 2 }))}
        onMouseDown={r(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>H2</button>
      <button style={btnS(editor.isActive('heading', { level: 3 }))}
        onMouseDown={r(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>H3</button>
      <span style={SEP} />
      <button style={btnS(editor.isActive('bulletList'))}
        onMouseDown={r(() => editor.chain().focus().toggleBulletList().run())}>• 목록</button>
      <button style={btnS(editor.isActive('orderedList'))}
        onMouseDown={r(() => editor.chain().focus().toggleOrderedList().run())}>1. 목록</button>
      <button style={btnS(editor.isActive('taskList'))}
        onMouseDown={r(() => editor.chain().focus().toggleTaskList().run())}>☑ 할일</button>
      <span style={SEP} />
      <button style={btnS(editor.isActive('blockquote'))}
        onMouseDown={r(() => editor.chain().focus().toggleBlockquote().run())}>&gt; 인용</button>
      <button style={btnS(editor.isActive('codeBlock'))}
        onMouseDown={r(() => editor.chain().focus().toggleCodeBlock().run())}>{'{ }'} 코드</button>
      <span style={SEP} />
      <button
        style={{ ...btnS(false), opacity: imgLoading ? 0.5 : 1 }}
        onMouseDown={e => { e.preventDefault(); if (!imgLoading) onImageClick(); }}
        title="이미지 업로드"
      >
        {imgLoading ? '업로드 중…' : '🖼 이미지'}
      </button>
      <button style={btnS(editor.isActive('link'))}
        onMouseDown={e => {
          e.preventDefault();
          const url = window.prompt('링크 URL을 입력하세요:', 'https://');
          if (url) editor.chain().focus().setLink({ href: url }).run();
          else if (url === '') editor.chain().focus().unsetLink().run();
        }}>🔗 링크</button>
      <span style={SEP} />
      <button style={btnS(false)}
        onMouseDown={r(() => editor.chain().focus().setHorizontalRule().run())}>— 구분선</button>
      <span style={{ flex: 1 }} />
      <button style={btnS(false)} onMouseDown={r(() => editor.chain().focus().undo().run())} title="실행 취소">↩</button>
      <button style={btnS(false)} onMouseDown={r(() => editor.chain().focus().redo().run())} title="다시 실행">↪</button>
    </div>
  );
}

// ── 에디터 컴포넌트 ───────────────────────────────────────────────────────────

interface GuideEditorProps {
  content?: object;
  onChange?: (json: object) => void;
  articleId?: string;
  placeholder?: string;
  minHeight?: string | number;
}

export default function GuideEditor({
  content,
  onChange,
  articleId = 'draft',
  placeholder = '가이드 내용을 입력하세요…',
  minHeight = 400,
}: GuideEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imgLoading, setImgLoading] = React.useState(false);
  const [imgError,   setImgError]   = React.useState<string | null>(null);

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

  const handleFile = async (file: File) => {
    if (!editor) return;
    setImgError(null);
    setImgLoading(true);
    try {
      const url = await uploadHelpImage(file, articleId);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      setImgError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setImgLoading(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r-2)', overflow: 'hidden', background: 'var(--sur)' }}>
      {editor && (
        <Toolbar
          editor={editor}
          onImageClick={() => fileInputRef.current?.click()}
          imgLoading={imgLoading}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {imgError && (
        <div style={{ padding: '6px 12px', background: 'var(--shb)', color: 'var(--shf)', fontSize: 'var(--fs-sm)', borderBottom: '1px solid var(--bd)' }}>
          {imgError}
        </div>
      )}
      <div style={{
        padding: '12px 20px',
        minHeight,
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
