// Supabase Edge Function: FCM v1 push from Database Webhooks (multiple tables).
// Auth: service-account JWT → Google OAuth token (no Node Firebase Admin SDK).

import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.2.4";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_BODY_LENGTH = 2000;

const TABLES_HANDLED = new Set([
  "posts",
  "band_projects",
  "post_likes",
  "reply_likes",
  "band_role_applicants",
  /** Threaded replies: `post_id`, `user_id`, `content`, optional `parent_id` → `post_replies.id`. */
  "post_replies",
]);

interface DbWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function normalizePrivateKey(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim();
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function truncateBody(s: string): string {
  return s.length <= MAX_BODY_LENGTH ? s : s.slice(0, MAX_BODY_LENGTH);
}

function buildPostNotificationBody(record: Record<string, unknown>): string {
  const content = asNonEmptyString(record.content);
  if (content) return truncateBody(content);
  const title = asNonEmptyString(record.song_title) ?? "";
  const artist = asNonEmptyString(record.artist_name) ?? "";
  const cap = asNonEmptyString(record.caption);
  const main = [title, artist].filter(Boolean).join(" — ");
  const withCap = cap ? (main ? `${main}（${cap}）` : cap) : main;
  return truncateBody(withCap || "新しい投稿");
}

function buildBandProjectNotificationBody(record: Record<string, unknown>): string {
  const name = asNonEmptyString(record.band_name) ?? "";
  const desc = asNonEmptyString(record.description);
  if (name && desc) return truncateBody(`${name}: ${desc}`);
  if (name) return truncateBody(name);
  if (desc) return truncateBody(desc);
  return "新しいバンド募集";
}

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
  const rawKey = getEnv("FIREBASE_PRIVATE_KEY");
  const privateKeyPem = normalizePrivateKey(rawKey);
  const key = await importPKCS8(privateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${text}`);
  }

  const json = (await tokenRes.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Google token response missing access_token");
  }
  return json.access_token;
}

/**
 * Data-only payload avoids the browser auto-displaying a notification in the background
 * while `onBackgroundMessage` also calls `showNotification` (duplicate banners).
 * Title/body are read in the client SW and in `onMessage` (foreground toast).
 */
/** FCM `data` values must be strings. */
function buildFcmDataPayload(
  title: string,
  body: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { title, body };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

async function sendFcmToToken(
  accessToken: string,
  firebaseProjectId: string,
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const url =
    `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        data: buildFcmDataPayload(title, body, data),
      },
    }),
  });
  const detail = await res.text();
  return { ok: res.ok, status: res.status, detail };
}

/**
 * Expired / uninstalled clients: FCM v1 often returns HTTP 404 with NOT_FOUND, or the
 * legacy-style "NotRegistered" / "UNREGISTERED" strings in the error body.
 */
function isUnregisteredFcmToken(status: number, detail: string): boolean {
  if (status === 404) return true;
  const u = detail.toUpperCase();
  if (u.includes("NOTREGISTERED") || u.includes("UNREGISTERED")) return true;
  return false;
}

const DELETE_TOKENS_IN_CHUNK = 80;

async function deleteFcmTokensByValue(
  supabase: SupabaseClient,
  tokens: string[],
): Promise<{ deletedAttempt: number; error: string | null }> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0))];
  if (unique.length === 0) {
    return { deletedAttempt: 0, error: null };
  }

  for (let i = 0; i < unique.length; i += DELETE_TOKENS_IN_CHUNK) {
    const slice = unique.slice(i, i + DELETE_TOKENS_IN_CHUNK);
    const { error } = await supabase.from("fcm_tokens").delete().in("token", slice);
    if (error) {
      return { deletedAttempt: unique.length, error: error.message };
    }
  }

  return { deletedAttempt: unique.length, error: null };
}

/** One FCM HTTP request per unique token string (dedupe duplicate DB rows). */
function dedupeFcmTokenStrings(
  rows: { token?: string | null }[] | null,
): string[] {
  const raw = (rows ?? []).map((r) =>
    typeof r.token === "string" ? r.token.trim() : ""
  ).filter((t) => t.length > 0);
  const uniqueTokens = [...new Set(raw)];
  if (raw.length !== uniqueTokens.length) {
    console.log(
      `[send-notification] deduped FCM tokens: ${raw.length} rows -> ${uniqueTokens.length} unique`,
    );
  }
  return uniqueTokens;
}

async function fetchAllFcmTokens(
  supabase: SupabaseClient,
): Promise<{ tokens: string[]; error: string | null }> {
  const { data: rows, error: dbError } = await supabase
    .from("fcm_tokens")
    .select("token");

  if (dbError) {
    return { tokens: [], error: dbError.message };
  }

  return { tokens: dedupeFcmTokenStrings(rows ?? []), error: null };
}

async function fetchFcmTokensForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tokens: string[]; error: string | null }> {
  const { data: rows, error: dbError } = await supabase
    .from("fcm_tokens")
    .select("token")
    .eq("user_id", userId);

  if (dbError) {
    return { tokens: [], error: dbError.message };
  }

  return { tokens: dedupeFcmTokenStrings(rows ?? []), error: null };
}

async function fetchPostAuthorUserId(
  supabase: SupabaseClient,
  postId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("user_id")
    .eq("id", postId)
    .maybeSingle();

  if (error || !data) return null;
  const uid = (data as { user_id?: string }).user_id;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

/** `post_replies.user_id` for a given reply row (`id`). Used for reply likes and parent author. */
async function fetchReplyAuthorUserId(
  supabase: SupabaseClient,
  replyId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("post_replies")
    .select("user_id")
    .eq("id", replyId)
    .maybeSingle();

  if (error || !data) return null;
  const uid = (data as { user_id?: string }).user_id;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

/** Owner of the band project (recruitment creator). */
async function resolveBandProjectOwnerId(
  supabase: SupabaseClient,
  record: Record<string, unknown>,
): Promise<string | null> {
  let projectId = asNonEmptyString(record.project_id);

  if (!projectId) {
    const roleId = asNonEmptyString(record.role_id);
    if (!roleId) return null;
    const { data: roleRow, error: rErr } = await supabase
      .from("band_roles")
      .select("project_id")
      .eq("id", roleId)
      .maybeSingle();
    if (rErr || !roleRow) return null;
    const pid = (roleRow as { project_id?: string }).project_id;
    projectId = typeof pid === "string" && pid.length > 0 ? pid : null;
  }

  if (!projectId) return null;

  const { data: proj, error: pErr } = await supabase
    .from("band_projects")
    .select("owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (pErr || !proj) return null;
  const owner = (proj as { owner_id?: string }).owner_id;
  return typeof owner === "string" && owner.length > 0 ? owner : null;
}

type NotifyPlan =
  | { mode: "broadcast"; title: string; body: string; data?: Record<string, string> }
  | {
    mode: "targeted";
    title: string;
    body: string;
    userId: string;
    data?: Record<string, string>;
  };

/**
 * INSERT on `post_replies`: notify post owner (top-level) or parent reply author (`parent_id`).
 * Schema: `post_id` → `posts`, `user_id` = reply author, `content`, `parent_id` → parent `post_replies.id`.
 */
async function planPostReplyInsertNotification(
  supabase: SupabaseClient,
  record: Record<string, unknown>,
): Promise<{ plan: NotifyPlan | null; skipReason?: string }> {
  const postId = asNonEmptyString(record.post_id);
  const authorId = asNonEmptyString(record.user_id);
  if (!postId) {
    return { plan: null, skipReason: "post_replies missing post_id" };
  }
  if (!authorId) {
    return { plan: null, skipReason: "post_replies missing user_id" };
  }

  const parentReplyId = asNonEmptyString(record.parent_id);
  let recipientId: string | null;

  if (parentReplyId) {
    recipientId = await fetchReplyAuthorUserId(supabase, parentReplyId);
    if (!recipientId) {
      return { plan: null, skipReason: "parent post_replies row author not found" };
    }
  } else {
    recipientId = await fetchPostAuthorUserId(supabase, postId);
    if (!recipientId) {
      return { plan: null, skipReason: "post author not found" };
    }
  }

  if (recipientId === authorId) {
    return { plan: null, skipReason: "self-reply (author is recipient)" };
  }

  const title = parentReplyId ? "返信が届きました" : "新着コメントがあります";
  const rawContent = asNonEmptyString(record.content);
  const body = rawContent ? truncateBody(rawContent) : "（内容なし）";

  return {
    plan: {
      mode: "targeted",
      title,
      body,
      userId: recipientId,
      data: {
        click_action: "/",
        post_id: postId,
      },
    },
  };
}

async function planNotification(
  supabase: SupabaseClient,
  table: string,
  record: Record<string, unknown> | null,
): Promise<{ plan: NotifyPlan | null; skipReason?: string }> {
  if (!record) {
    return { plan: null, skipReason: "missing record" };
  }

  switch (table) {
    case "posts":
      return {
        plan: {
          mode: "broadcast",
          title: "新着投稿",
          body: buildPostNotificationBody(record),
        },
      };

    case "band_projects":
      return {
        plan: {
          mode: "broadcast",
          title: "新しいバンド募集",
          body: buildBandProjectNotificationBody(record),
        },
      };

    case "post_likes": {
      const postId = asNonEmptyString(record.post_id);
      if (!postId) return { plan: null, skipReason: "post_likes missing post_id" };
      const authorId = await fetchPostAuthorUserId(supabase, postId);
      if (!authorId) {
        return { plan: null, skipReason: "post author not found" };
      }
      const likerId = asNonEmptyString(record.user_id);
      if (likerId && likerId === authorId) {
        return { plan: null, skipReason: "self-like" };
      }
      return {
        plan: {
          mode: "targeted",
          title: "投稿にいいね！",
          body: "あなたの投稿が評価されました",
          userId: authorId,
        },
      };
    }

    case "reply_likes": {
      const replyId = asNonEmptyString(record.reply_id);
      if (!replyId) {
        return { plan: null, skipReason: "reply_likes missing reply_id" };
      }
      const authorId = await fetchReplyAuthorUserId(supabase, replyId);
      if (!authorId) {
        return { plan: null, skipReason: "reply author not found" };
      }
      const likerId = asNonEmptyString(record.user_id);
      if (likerId && likerId === authorId) {
        return { plan: null, skipReason: "self-like" };
      }
      return {
        plan: {
          mode: "targeted",
          title: "返信にいいね！",
          body: "あなたの返信が評価されました",
          userId: authorId,
        },
      };
    }

    case "band_role_applicants": {
      const ownerId = await resolveBandProjectOwnerId(supabase, record);
      if (!ownerId) {
        return {
          plan: null,
          skipReason: "band project owner not resolved",
        };
      }
      const applicantId = asNonEmptyString(record.user_id);
      if (applicantId && applicantId === ownerId) {
        return { plan: null, skipReason: "owner self-applicant" };
      }
      return {
        plan: {
          mode: "targeted",
          title: "バンド応募届きました！",
          body: "あなたの募集に新しい応募がありました",
          userId: ownerId,
        },
      };
    }

    case "post_replies":
      return planPostReplyInsertNotification(supabase, record);

    default:
      return { plan: null, skipReason: "unknown table" };
  }
}

async function sendToTokens(
  accessToken: string,
  firebaseProjectId: string,
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{
  success: number;
  failed: number;
  uniqueTokens: number;
  invalidTokens: string[];
}> {
  const uniqueTokens = [
    ...new Set(
      tokens.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t) =>
        t.length > 0
      ),
    ),
  ];

  const invalidTokens: string[] = [];
  const invalidSet = new Set<string>();

  const chunkSize = 15;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
    const chunk = uniqueTokens.slice(i, i + chunkSize);
    const outcomes = await Promise.all(
      chunk.map(async (deviceToken) => {
        const r = await sendFcmToToken(
          accessToken,
          firebaseProjectId,
          deviceToken,
          title,
          body,
          data,
        );
        return { ...r, deviceToken };
      }),
    );
    for (const o of outcomes) {
      if (o.ok) success++;
      else {
        failed++;
        if (isUnregisteredFcmToken(o.status, o.detail)) {
          if (!invalidSet.has(o.deviceToken)) {
            invalidSet.add(o.deviceToken);
            invalidTokens.push(o.deviceToken);
          }
        }
        console.error("FCM send failed:", o.status, o.detail);
      }
    }
  }
  return { success, failed, uniqueTokens: uniqueTokens.length, invalidTokens };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const firebaseProjectId = getEnv("FIREBASE_PROJECT_ID");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const payload = (await req.json()) as DbWebhookPayload;
    const type = payload.type ?? "";
    const table = payload.table ?? "";
    const record = payload.record ?? null;

    if (type !== "INSERT") {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "not INSERT" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!TABLES_HANDLED.has(table)) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "table not handled" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { plan, skipReason } = await planNotification(supabase, table, record);

    if (!plan) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: skipReason ?? "no plan" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let tokens: string[] = [];
    let tokenError: string | null = null;

    if (plan.mode === "broadcast") {
      const r = await fetchAllFcmTokens(supabase);
      tokens = r.tokens;
      tokenError = r.error;
    } else {
      const r = await fetchFcmTokensForUser(supabase, plan.userId);
      tokens = r.tokens;
      tokenError = r.error;
    }

    if (tokenError) {
      console.error("fcm_tokens select error:", tokenError);
      return new Response(
        JSON.stringify({ ok: false, error: tokenError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          message: "no tokens",
          table,
          mode: plan.mode,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const accessToken = await getGoogleAccessToken();
    const { success, failed, uniqueTokens: uniqueTokenCount, invalidTokens } =
      await sendToTokens(
        accessToken,
        firebaseProjectId,
        tokens,
        plan.title,
        plan.body,
        plan.data,
      );

    let tokensCleanedUp = 0;
    let cleanupError: string | null = null;
    if (invalidTokens.length > 0) {
      const del = await deleteFcmTokensByValue(supabase, invalidTokens);
      tokensCleanedUp = del.deletedAttempt;
      cleanupError = del.error;
      if (cleanupError) {
        console.error(
          "[send-notification] failed to delete invalid fcm_tokens:",
          cleanupError,
        );
      }
    }

    console.log(
      `[send-notification] FCM summary: sent=${success} failed_non_unreg=${
        failed - invalidTokens.length
      } invalid_unregistered=${invalidTokens.length} tokens_removed_from_db=${tokensCleanedUp}`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        table,
        mode: plan.mode,
        sent: success,
        failed,
        totalTokens: uniqueTokenCount,
        invalidTokensDetected: invalidTokens.length,
        tokensCleanedUp,
        ...(cleanupError ? { cleanupError } : {}),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("send-notification error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
