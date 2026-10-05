'use client';
import { useEffect, useState } from 'react';
import { kstToday } from '@/lib/format';

export function useKstToday() {
  const [today, setToday] = useState(kstToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(kstToday());
      const now = Date.now(), day = 86400000, offset = 9 * 3600000;
      timer = setTimeout(update, day - ((now + offset) % day) + 1);
    };
    update();
    return () => clearTimeout(timer);
  }, []);
  return today;
}
