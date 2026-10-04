import ShellClient from '@/components/shell/ShellClient';
import OnboardingProvider from '@/components/onboarding/OnboardingProvider';
import RankingDailyProvider from '@/components/ranking/RankingDailyProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingProvider><RankingDailyProvider><ShellClient>{children}</ShellClient></RankingDailyProvider></OnboardingProvider>;
}
