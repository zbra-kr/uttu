import ShellClient from '@/components/shell/ShellClient';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ShellClient>{children}</ShellClient>;
}
