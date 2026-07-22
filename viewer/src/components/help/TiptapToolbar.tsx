'use client';
import type { Editor } from '@tiptap/react';

interface Props {
  editor: Editor;
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 'var(--r-1)',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--fs-sm)',
    fontWeight: active ? 700 : 400,
    background: active ? 'var(--snk)' : 'transparent',
    color: active ? 'var(--f1)' : 'var(--f3)',
    transition: 'background 100ms, color 100ms',
    lineHeight: 1.6,
  };
}

const sep: React.CSSProperties = {
  width: 1, background: 'var(--bd)', margin: '2px 4px', alignSelf: 'stretch',
};

export default function TiptapToolbar({ editor }: Props) {
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
      padding: '5px 8px', borderBottom: '1px solid var(--bd)', background: 'var(--bg)',
    }}>
      <button style={btn(editor.isActive('bold'))}
        onMouseDown={run(() => editor.chain().focus().toggleBold().run())}>B</button>
      <button style={btn(editor.isActive('italic'))}
        onMouseDown={run(() => editor.chain().focus().toggleItalic().run())}>I</button>
      <button style={btn(editor.isActive('strike'))}
        onMouseDown={run(() => editor.chain().focus().toggleStrike().run())}>S</button>

      <span style={sep} />

      <button style={btn(editor.isActive('heading', { level: 1 }))}
        onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>H1</button>
      <button style={btn(editor.isActive('heading', { level: 2 }))}
        onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>H2</button>
      <button style={btn(editor.isActive('heading', { level: 3 }))}
        onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>H3</button>

      <span style={sep} />

      <button style={btn(editor.isActive('bulletList'))}
        onMouseDown={run(() => editor.chain().focus().toggleBulletList().run())}>• 목록</button>
      <button style={btn(editor.isActive('orderedList'))}
        onMouseDown={run(() => editor.chain().focus().toggleOrderedList().run())}>1. 목록</button>
      <button style={btn(editor.isActive('taskList'))}
        onMouseDown={run(() => editor.chain().focus().toggleTaskList().run())}>☑ 할일</button>

      <span style={sep} />

      <button style={btn(editor.isActive('blockquote'))}
        onMouseDown={run(() => editor.chain().focus().toggleBlockquote().run())}>&gt; 인용</button>
      <button style={btn(editor.isActive('codeBlock'))}
        onMouseDown={run(() => editor.chain().focus().toggleCodeBlock().run())}>{'{ }'} 코드</button>
      <button style={btn(false)}
        onMouseDown={run(() => editor.chain().focus().setHorizontalRule().run())}>— 구분선</button>

      <span style={{ flex: 1 }} />

      <button style={btn(false)}
        onMouseDown={run(() => editor.chain().focus().undo().run())}
        title="실행 취소">↩</button>
      <button style={btn(false)}
        onMouseDown={run(() => editor.chain().focus().redo().run())}
        title="다시 실행">↪</button>
    </div>
  );
}
