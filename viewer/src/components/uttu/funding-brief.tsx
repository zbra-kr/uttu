import React from 'react';

interface Props {
  companyId: string;
  // brief_writer not implemented yet — Round 4 예정
}

export function FundingBrief({ companyId: _companyId }: Props) {
  return (
    <div style={{
      padding: '40px 0',
      textAlign: 'center',
      color: 'var(--f4)',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 500, marginBottom: 6, color: 'var(--f3)' }}>브리핑 생성 예정</div>
      <div>brief_writer 구현 후 자동 활성화됩니다</div>
    </div>
  );
}
