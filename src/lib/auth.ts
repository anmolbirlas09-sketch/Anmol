import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from './supabase/server';
import type { AppUser } from './types';

/** The signed-in user's profile, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase
    .from('app_users')
    .select('id, name, email, role, factory_id, active')
    .eq('id', uid)
    .maybeSingle();
  if (!profile) return { id: uid, name: String(data.claims.email ?? ''), email: String(data.claims.email ?? ''), role: 'data_entry', factory_id: null, active: false };
  return profile as AppUser;
});

/** For pages inside the app: signed in and activated by the owner. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.active) redirect('/pending');
  return user;
}

export const canEdit = (u: Pick<AppUser, 'role'>) => u.role === 'owner' || u.role === 'supervisor';
export const isOwner = (u: Pick<AppUser, 'role'>) => u.role === 'owner';
