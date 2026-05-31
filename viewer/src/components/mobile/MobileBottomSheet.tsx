'use client';
import { useEffect, useRef } from 'react';

export interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function MobileBottomSheet({ open, onClose, children }: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number>(0);
  const currentY = useRef<number>(0);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handlePointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    currentY.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const dy = e.clientY - startY.current;
    if (dy > 0) {
      currentY.current = dy;
      if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }

  function handlePointerUp() {
    if (currentY.current > 80) {
      onClose();
    } else {
      if (sheetRef.current) sheetRef.current.style.transform = '';
    }
    currentY.current = 0;
  }

  if (!open) return null;

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        ref={sheetRef}
        style={{
          width: '100%',
          background: 'var(--snk)',
          borderRadius: '16px 16px 0 0',
          maxHeight: '80dvh',
          overflowY: 'auto',
          transition: 'transform 0.3s ease-out',
        }}
      >
        {/* 드래그 핸들 */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 8px', cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--bd)' }} />
        </div>
        <div style={{ padding: '0 16px 32px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
