import type { Metadata } from 'next';
import { L } from '@/lib/labels';
import { AuthShell } from '../AuthShell';
import { SignUpForm } from '../AuthForms';

export const metadata: Metadata = { title: L.auth.signUp };

export default function SignUpPage() {
  return (
    <AuthShell title={L.auth.signUp}>
      <SignUpForm />
    </AuthShell>
  );
}
