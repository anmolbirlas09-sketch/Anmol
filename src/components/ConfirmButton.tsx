'use client';

import { useFormStatus } from 'react-dom';
import { L } from '@/lib/labels';

/** Submit button that asks for confirmation first. */
export function ConfirmButton({ children, message = L.app.confirmDelete, className }: { children: React.ReactNode; message?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
