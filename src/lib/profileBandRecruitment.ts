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
  applicantsByRoleId: Record<string, ApplicantPreview[]>;
}> {
  const { data: projects, error: pErr } = await supabase
    .from('band_projects')
    .select('id, owner_id, band_name, description, created_at')
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
    .in('project_id', ids);

  if (rErr) {
    console.error('[band_roles] fetch', rErr);
    return { projects: plist.map((p) => ({ ...p, roles: [] })), applicantsById: {} };
  }

  const roleRows = (roles ?? []) as DbBandRole[];
  const byProject = new Map<string, DbBandRole[]>();
  for (const r of roleRows) {
    const list = byProject.get(r.project_id) ?? [];
    list.push(r);
    byProject.set(r.project_id, list);
  }

  const roleIds = roleRows.map((r) => r.id);
  const applicantsById: Record<string, ApplicantPreview> = {};
  const applicantsByRoleId: Record<string, ApplicantPreview[]> = {};
  if (roleIds.length > 0) {
    const { data: appl, error: aErr } = await supabase
      .from('band_role_applicants')
      .select('role_id, user_id, users(id, display_name, avatar_url)')
      .in('role_id', roleIds);

    if (aErr) {
      console.error('[band_role_applicants] fetch', aErr);
    } else {
      for (const rowAny of (appl ?? []) as any[]) {
        const roleId = String(rowAny.role_id || '').trim();
        const userId = String(rowAny.user_id || '').trim();
        if (!roleId || !userId) continue;
        const u = rowAny.users as
          | { id: string; display_name: string | null; avatar_url: string | null }
          | null
          | undefined;
        const preview: ApplicantPreview = {
          id: userId,
          name: (u?.display_name ?? '').trim() || 'ユーザー',
          avatar: u?.avatar_url ?? '',
        };
        applicantsById[userId] = applicantsById[userId] ?? preview;
        const list = applicantsByRoleId[roleId] ?? [];
        list.push(preview);
        applicantsByRoleId[roleId] = list;
      }
    }
  }

  const projectsWithRoles: BandProjectWithRoles[] = plist.map((p) => ({
    ...p,
    roles: (byProject.get(p.id) ?? []).sort((a, b) =>
      a.instrument_type.localeCompare(b.instrument_type),
    ),
  }));

  return { projects: projectsWithRoles, applicantsById, applicantsByRoleId };
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
      band_name: name,
      description: params.description.trim() || null,
    })
    .select('id')
    .single();

  if (pErr || !proj) {
    return { error: pErr?.message ?? '作成に失敗しました。' };
  }

  const projectId = (proj as { id: string }).id;
  const rows = params.instruments.map((instrument_type) => ({
    project_id: projectId,
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
