'use client';
import { useEffect, useState } from 'react';

export type ResolvedViewport = 'mobile' | 'desktop' | null;

/** Opt-in gate: server and first client render mount neither data subtree. */
export function useResolvedViewport(): ResolvedViewport {
  const [viewport, setViewport] = useState<ResolvedViewport>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setViewport(media.matches ? 'mobile' : 'desktop');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return viewport;
}
