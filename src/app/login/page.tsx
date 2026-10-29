import type { Metadata } from 'next';
import { L } from '@/lib/labels';
import { AuthShell } from '../AuthShell';
import { SignInForm } from '../AuthForms';

export const metadata: Metadata = { title: L.auth.signIn };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams;
  return (
    <AuthShell title={L.auth.signIn}>
      <SignInForm next={typeof next === 'string' ? next : undefined} />
    </AuthShell>
  );
}
