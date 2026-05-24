'use client';
import React from 'react';
import { IcBookmark } from '@/components/ui/icons';
import { addBookmark, removeBookmark, isBookmarked, EntityType } from '@/lib/queries-me';

interface Props {
  entity_type: EntityType;
  entity_id: string;
  label?: string;
  size?: number;
  className?: string;
  inactiveText?: string;
  activeText?: string;
}

export default function BookmarkToggle({ entity_type, entity_id, label, size = 16, className, inactiveText, activeText }: Props) {
  const [bookmarked, setBookmarked] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!entity_id) return;
    isBookmarked(entity_type, entity_id).then(setBookmarked);
  }, [entity_type, entity_id]);

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading || bookmarked === null) return;
    setLoading(true);
    if (bookmarked) {
      const { error } = await removeBookmark(entity_type, entity_id);
      if (!error) setBookmarked(false);
    } else {
      const { error } = await addBookmark(entity_type, entity_id, label);
      if (!error) setBookmarked(true);
    }
    setLoading(false);
  }

  const hasText = !!(inactiveText || activeText);
  const displayText = bookmarked ? (activeText ?? inactiveText) : inactiveText;

  // 텍스트 없는 경우: 로딩 중 null 반환 (아이콘만 버튼)
  // 텍스트 있는 경우: 로딩 중에도 버튼 표시 (placeholder)
  if (bookmarked === null && !hasText) return null;

  return (
    <button
      onClick={handleToggle}
      disabled={loading || bookmarked === null}
      title={bookmarked ? '북마크 해제' : '북마크'}
      className={`btn sm${className ? ` ${className}` : ''}`}
      style={{
        opacity: loading || bookmarked === null ? 0.5 : 1,
        ...(bookmarked ? { color: 'var(--smf)', borderColor: 'var(--smf)' } : {}),
      }}
    >
      <IcBookmark
        size={size}
        stroke={1.5}
        fill={bookmarked ? 'var(--smf)' : 'none'}
      />
      {hasText && displayText}
    </button>
  );
}
