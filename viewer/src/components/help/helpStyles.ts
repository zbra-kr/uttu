import type { CSSProperties } from 'react';

/** className을 wrapper div에 부착하면 TIPTAP_OUTPUT_CSS 스타일이 적용됨 */
export const OUTPUT_CLS = 'tiptap-output';

/** wrapper 인라인 스타일 (tokens.css 변수만 사용) */
export const outputContainerStyle: CSSProperties = {
  color: 'var(--f1)',
  fontFamily: 'var(--sans)',
  fontSize: 'var(--fs-md)',
  lineHeight: 1.75,
};

/**
 * .tiptap-output 전용 CSS 문자열.
 * Stage B에서 app.css에 추가하거나 <style> 태그로 주입.
 * hex 하드코딩 없음 — tokens.css 변수만 사용.
 */
export const TIPTAP_OUTPUT_CSS = `
.tiptap-output { color: var(--f1); font-family: var(--sans); font-size: var(--fs-md); line-height: 1.75; }
.tiptap-output > * + * { margin-top: 0.6em; }
.tiptap-output h1 { font-size: var(--fs-3xl); font-weight: 700; margin: 1.25em 0 0.4em; color: var(--f1); }
.tiptap-output h2 { font-size: var(--fs-2xl); font-weight: 600; margin: 1em 0 0.35em; color: var(--f1); }
.tiptap-output h3 { font-size: var(--fs-xl); font-weight: 600; margin: 0.85em 0 0.3em; color: var(--f2); }
.tiptap-output p { margin: 0; }
.tiptap-output a { color: var(--hs); text-decoration: underline; }
.tiptap-output strong { font-weight: 700; }
.tiptap-output em { font-style: italic; }
.tiptap-output s { text-decoration: line-through; color: var(--f3); }
.tiptap-output ul, .tiptap-output ol { padding-left: 1.5em; }
.tiptap-output li + li { margin-top: 0.2em; }
.tiptap-output blockquote { border-left: 3px solid var(--bd); padding-left: 1em; color: var(--f3); }
.tiptap-output pre { background: var(--snk); border-radius: var(--r-2); padding: 12px 16px; overflow-x: auto; }
.tiptap-output code { font-family: var(--mono); font-size: var(--fs-sm); background: var(--snk); padding: 1px 4px; border-radius: var(--r-1); }
.tiptap-output pre code { background: none; padding: 0; }
.tiptap-output hr { border: none; border-top: 1px solid var(--bd); }
.tiptap-output table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.tiptap-output th, .tiptap-output td { border: 1px solid var(--bd); padding: 6px 10px; text-align: left; }
.tiptap-output th { background: var(--snk); font-weight: 600; color: var(--f2); }
.tiptap-output ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
.tiptap-output ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 6px; }
.tiptap-output ul[data-type="taskList"] li > label { flex-shrink: 0; margin-top: 3px; }
.tiptap-output img { max-width: 100%; border-radius: var(--r-2); }
`.trim();
