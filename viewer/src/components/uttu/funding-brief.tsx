'use client';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fmtDateTime } from '@/lib/format';

interface Props {
  companyId: string;
  briefMd: string | null;
  briefAt: string | null;
}

const BRIEF_STYLE = `
.funding-brief h1, .funding-brief h2, .funding-brief h3 {
  color: var(--f1);
  font-family: var(--sans);
  font-weight: 600;
  margin: 12px 0 6px;
  border-bottom: 1px solid var(--bd);
  padding-bottom: 4px;
}
.funding-brief h1 { font-size: 15px; }
.funding-brief h2 { font-size: 14px; }
.funding-brief h3 { font-size: 13px; }
.funding-brief p { margin: 6px 0; color: var(--f2); line-height: 1.8; }
.funding-brief table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--mono);
  margin: 10px 0;
}
.funding-brief table th {
  background: var(--sur);
  border: 1px solid var(--bd);
  padding: 5px 8px;
  text-align: left;
  color: var(--f3);
  font-weight: 500;
}
.funding-brief table td {
  border: 1px solid var(--bd);
  padding: 5px 8px;
  color: var(--f1);
}
.funding-brief table tr:nth-child(even) td { background: var(--snk); }
.funding-brief ul, .funding-brief ol { padding-left: 18px; margin: 6px 0; }
.funding-brief li { color: var(--f2); margin: 3px 0; line-height: 1.7; }
.funding-brief strong { color: var(--f1); font-weight: 600; }
.funding-brief em { color: var(--f3); font-style: italic; }
.funding-brief blockquote {
  border-left: 3px solid var(--hs);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--f3);
  background: var(--snk);
  border-radius: 0 4px 4px 0;
}
.funding-brief code {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--snk);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--hs);
}
.funding-brief pre code {
  background: transparent;
  padding: 0;
  color: var(--f1);
  font-size: 12px;
}
.funding-brief pre {
  background: var(--snk);
  border: 0.5px solid var(--bs);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 6px 0;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--f1);
}
.funding-brief hr { border: none; border-top: 0.5px solid var(--bs); margin: 10px 0; }
.funding-brief a { color: var(--hs); text-decoration: underline; text-underline-offset: 2px; }
.funding-brief-table-wrap { overflow-x: auto; }
`;

export function FundingBrief({ companyId: _companyId, briefMd, briefAt }: Props) {
  if (!briefMd) {
    return (
      <div style={{
        padding: '40px 0',
        textAlign: 'center',
        color: 'var(--f4)',
        fontSize: 12,
      }}>
        <div style={{ fontWeight: 500, marginBottom: 6, color: 'var(--f3)' }}>브리핑 생성 예정</div>
        <div>투자정보 수집 후 자동 생성됩니다</div>
      </div>
    );
  }

  return (
    <>
      <style>{BRIEF_STYLE}</style>
      <div
        className="funding-brief"
        style={{
          fontSize: 13,
          lineHeight: 1.8,
          color: 'var(--f1)',
          fontFamily: 'var(--sans)',
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => (
              <div className="funding-brief-table-wrap">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {briefMd}
        </ReactMarkdown>
      </div>
      {briefAt && (
        <div style={{
          marginTop: 12,
          fontSize: 10,
          color: 'var(--f4)',
          fontFamily: 'var(--mono)',
          textAlign: 'right',
        }}>
          생성: {fmtDateTime(briefAt)}
        </div>
      )}
    </>
  );
}
