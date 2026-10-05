'use client';
import { createContext, useContext } from 'react';
import type { useObservationReviews } from '@/hooks/useObservationReviews';
export const ObservationReviewContext = createContext<ReturnType<typeof useObservationReviews> | null>(null);
export const useObservationReviewState = () => useContext(ObservationReviewContext);
