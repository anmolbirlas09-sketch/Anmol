import { L } from '@/lib/labels';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="text-2xl font-bold">{L.app.name}</div>
        <div className="text-sm text-muted">{L.app.tagline}</div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">
        <h1 className="mb-4 text-xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
