import ShellClient from '@/components/shell/ShellClient';
import OnboardingProvider from '@/components/onboarding/OnboardingProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingProvider><ShellClient>{children}</ShellClient></OnboardingProvider>;
}
