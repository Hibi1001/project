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

export type ApplicantStatus = 'pending' | 'accepted' | 'declined';

export type ProjectApplicantRow = {
  roleId: string;
  userId: string;
  displayName: string;
  avatarUrl: string;
  roleLabel: string;
  status: ApplicantStatus;
};

export type RoleApplicantRow = {
  roleId: string;
  userId: string;
  displayName: string;
  avatarUrl: string;
  status: ApplicantStatus;
};

const ROLE_LABEL_BY_TYPE: Record<InstrumentType, string> = {
  vocal: 'Vocal',
  guitar: 'Guitar',
  bass: 'Bass',
  drum: 'Drums',
  keyboard: 'Keyboard',
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

export async function fetchApplicantsForOwnerProject(
  projectId: string,
): Promise<ProjectApplicantRow[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return [];

    const { data: ownerRow, error: ownerError } = await supabase
      .from('band_projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', uid)
      .maybeSingle();
    if (ownerError || !ownerRow) {
      if (ownerError) console.error('[band_projects] owner check', ownerError);
      return [];
    }

    const { data, error } = await supabase
      .from('band_role_applicants')
      .select(
        'role_id, user_id, status, band_roles!inner(project_id, instrument_type), users(id, display_name, avatar_url)',
      )
      .eq('band_roles.project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[band_role_applicants] owner project fetch', error);
      return [];
    }

    const rows: ProjectApplicantRow[] = [];
    for (const row of (data ?? []) as Array<{
      role_id: string | null;
      user_id: string | null;
      status?: string | null;
      band_roles?: { project_id?: string | null; instrument_type?: InstrumentType | null }[] | null;
      users?: { id?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
    }>) {
      const roleId = String(row.role_id ?? '').trim();
      const userId = String(row.user_id ?? '').trim();
      if (!roleId || !userId) continue;
      const role = Array.isArray(row.band_roles) ? row.band_roles[0] : row.band_roles;
      const inst = (role?.instrument_type ?? 'vocal') as InstrumentType;
      const rawStatus = String(row.status ?? 'pending').toLowerCase();
      const status: ApplicantStatus =
        rawStatus === 'accepted' || rawStatus === 'declined' ? rawStatus : 'pending';
      rows.push({
        roleId,
        userId,
        displayName: String(row.users?.display_name ?? '').trim() || 'ユーザー',
        avatarUrl: String(row.users?.avatar_url ?? '').trim(),
        roleLabel: ROLE_LABEL_BY_TYPE[inst],
        status,
      });
    }
    return rows;
  } catch (e) {
    console.error('[fetchApplicantsForOwnerProject]', e);
    return [];
  }
}

export async function updateApplicantStatus(
  roleId: string,
  userId: string,
  status: ApplicantStatus,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('band_role_applicants')
      .update({ status })
      .eq('role_id', roleId)
      .eq('user_id', userId);
    if (error) {
      console.error('[updateApplicantStatus]', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[updateApplicantStatus]', e);
    return false;
  }
}

export async function removeApplicantFromProjectRole(
  roleId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('band_role_applicants')
      .delete()
      .eq('role_id', roleId)
      .eq('user_id', userId);
    if (error) {
      console.error('[removeApplicantFromProjectRole]', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[removeApplicantFromProjectRole]', e);
    return false;
  }
}

export async function fetchApplicantsForRole(
  roleId: string,
): Promise<RoleApplicantRow[]> {
  try {
    const { data, error } = await supabase
      .from('band_role_applicants')
      .select('role_id, user_id, status, users(id, display_name, avatar_url)')
      .eq('role_id', roleId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[fetchApplicantsForRole]', error);
      return [];
    }

    const rows: RoleApplicantRow[] = [];
    for (const row of (data ?? []) as Array<{
      role_id: string | null;
      user_id: string | null;
      status?: string | null;
      users?: { id?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
    }>) {
      const rid = String(row.role_id ?? '').trim();
      const uid = String(row.user_id ?? '').trim();
      if (!rid || !uid) continue;
      const rawStatus = String(row.status ?? 'pending').toLowerCase();
      const status: ApplicantStatus =
        rawStatus === 'accepted' || rawStatus === 'declined' ? rawStatus : 'pending';
      rows.push({
        roleId: rid,
        userId: uid,
        displayName: String(row.users?.display_name ?? '').trim() || 'ユーザー',
        avatarUrl: String(row.users?.avatar_url ?? '').trim(),
        status,
      });
    }
    return rows;
  } catch (e) {
    console.error('[fetchApplicantsForRole]', e);
    return [];
  }
}
