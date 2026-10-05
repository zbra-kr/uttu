'use client';
import { createContext } from 'react';
import type { useDailyReportLoader } from '@/hooks/useDailyReport';

export type DailyReportSnapshot = ReturnType<typeof useDailyReportLoader>;
export const ReportOwnerContext = createContext<{ managed: boolean; active: boolean; report: DailyReportSnapshot | null }>({ managed: false, active: false, report: null });
