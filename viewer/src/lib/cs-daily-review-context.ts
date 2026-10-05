'use client';
import { createContext, useContext } from 'react';
import type { CSDailyReviewState } from '@/hooks/useCSDailyReviewCheck';

export const CSDailyReviewContext = createContext<CSDailyReviewState | null>(null);
export const useCSDailyReviewState = () => useContext(CSDailyReviewContext);
