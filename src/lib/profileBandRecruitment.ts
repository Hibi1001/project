import { supabase } from './supabase';
import type { DbBandProject, DbBandRole, InstrumentType } from '../types';

export type BandProjectWithRoles = DbBandProject & {
  roles: DbBandRole[];
};

export type ApplicantPreview = {
  id: string;
  name: string;
  avatar: string;
};

/** Load all band projects for the profile being viewed, with roles and applicant previews. */
export async function fetchBandProjectsForOwner(
  ownerUserId: string,
): Promise<{
  projects: BandProjectWithRoles[];
  applicantsById: Record<string, ApplicantPreview>;
}> {
  const { data: projects, error: pErr } = await supabase
    .from('band_projects')
    .select('*')
    .eq('owner_id', ownerUserId)
    .order('created_at', { ascending: false });

  if (pErr) {
    console.error('[band_projects] fetch', pErr);
    return { projects: [], applicantsById: {} };
  }

  const plist = (projects ?? []) as DbBandProject[];
  if (plist.length === 0) {
    return { projects: [], applicantsById: {} };
  }

  const ids = plist.map((p) => p.id);
  const { data: roles, error: rErr } = await supabase
    .from('band_roles')
    .select('*')
    .in('band_project_id', ids);

  if (rErr) {
    console.error('[band_roles] fetch', rErr);
    return { projects: plist.map((p) => ({ ...p, roles: [] })), applicantsById: {} };
  }

  const roleRows = (roles ?? []) as DbBandRole[];
  const byProject = new Map<string, DbBandRole[]>();
  for (const r of roleRows) {
    const list = byProject.get(r.band_project_id) ?? [];
    list.push(r);
    byProject.set(r.band_project_id, list);
  }

  const applicantIds = [
    ...new Set(
      roleRows.map((r) => r.applicant_id).filter((id): id is string => Boolean(id)),
    ),
  ];

  const applicantsById: Record<string, ApplicantPreview> = {};
  if (applicantIds.length > 0) {
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, display_name, avatar_url')
      .in('id', applicantIds);

    if (!uErr && users) {
      for (const u of users as {
        id: string;
        display_name: string;
        avatar_url: string | null;
      }[]) {
        applicantsById[u.id] = {
          id: u.id,
          name: u.display_name ?? 'ユーザー',
          avatar: u.avatar_url ?? '',
        };
      }
    }
  }

  const projectsWithRoles: BandProjectWithRoles[] = plist.map((p) => ({
    ...p,
    roles: (byProject.get(p.id) ?? []).sort((a, b) =>
      a.instrument_type.localeCompare(b.instrument_type),
    ),
  }));

  return { projects: projectsWithRoles, applicantsById };
}

export async function createBandProjectWithRoles(params: {
  ownerId: string;
  name: string;
  description: string;
  instruments: InstrumentType[];
}): Promise<{ error: string | null; projectId?: string }> {
  const name = params.name.trim();
  if (!name) return { error: 'バンド名を入力してください。' };
  if (params.instruments.length === 0) {
    return { error: '募集パートを1つ以上選んでください。' };
  }

  const { data: proj, error: pErr } = await supabase
    .from('band_projects')
    .insert({
      owner_id: params.ownerId,
      name,
      description: params.description.trim() || null,
    })
    .select('id')
    .single();

  if (pErr || !proj) {
    return { error: pErr?.message ?? '作成に失敗しました。' };
  }

  const projectId = (proj as { id: string }).id;
  const rows = params.instruments.map((instrument_type) => ({
    band_project_id: projectId,
    instrument_type,
  }));

  const { error: rErr } = await supabase.from('band_roles').insert(rows);
  if (rErr) {
    await supabase.from('band_projects').delete().eq('id', projectId);
    return { error: rErr.message };
  }

  return { error: null, projectId };
}

export async function claimBandRole(roleId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { ok: false, error: 'ログインが必要です。' };

  const { error } = await supabase
    .from('band_roles')
    .update({ applicant_id: uid })
    .eq('id', roleId)
    .is('applicant_id', null);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
