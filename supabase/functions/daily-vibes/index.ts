// Supabase Edge Function: scheduled "Daily Vibes" morning push to all FCM tokens.
// Auth: google-auth-library → OAuth access token for FCM HTTP v1 (same env as send-notification).

import { GoogleAuth } from "https://esm.sh/google-auth-library@9.14.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const MESSAGE_VARIANTS: { title: string; body: string }[] = [
  {
    title: "今日を始めよう",
    body:
      "今日はどんな曲で始める？みんなとシェアしよう！",
  },
  {
    title: "今日の気分は？",
    body: "今の気分を表す1曲は？",
  },
  {
    title: "朝の1曲をシェアしよう！",
    body: "今日も1日頑張ろう。どんな曲で1日をスタートする？",
  },
];

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function normalizePrivateKey(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim();
}

/** Optional: set `DAILY_VIBES_CRON_SECRET` and send `Authorization: Bearer <secret>`. */
function assertCronAuthorized(req: Request): Response | null {
  const secret = Deno.env.get("DAILY_VIBES_CRON_SECRET")?.trim() ?? "";
  if (secret === "") return null;
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
  const rawKey = getEnv("FIREBASE_PRIVATE_KEY");
  const privateKey = normalizePrivateKey(rawKey);

  const auth = new GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: [FCM_SCOPE],
  });

  const client = await auth.getClient();
  const res = await client.getAccessToken();
  const token =
    typeof res === "string"
      ? res
      : res && typeof res === "object" && "token" in res && res.token
      ? String(res.token)
      : null;
  if (!token) {
    throw new Error("GoogleAuth.getAccessToken returned no token");
  }
  return token;
}

function buildFcmDataPayload(
  title: string,
  body: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {
    title: title.trim() || "マイセッション",
    body: body.trim() || "タップしてアプリを開く",
    click_action: "/?action=open_post_modal",
    kind: "daily_morning_check",
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
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

function dedupeFcmTokenStrings(
  rows: { token?: string | null }[] | null,
): string[] {
  const raw = (rows ?? []).map((r) =>
    typeof r.token === "string" ? r.token.trim() : ""
  ).filter((t) => t.length > 0);
  return [...new Set(raw)];
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

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const unauthorized = assertCronAuthorized(req);
  if (unauthorized) return unauthorized;

  try {
    const firebaseProjectId = getEnv("FIREBASE_PROJECT_ID");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { tokens, error: tokenError } = await fetchAllFcmTokens(supabase);

    if (tokenError) {
      console.error("[daily-vibes] fcm_tokens select error:", tokenError);
      return new Response(JSON.stringify({ ok: false, error: tokenError }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          message: "no tokens",
          variant: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const variant =
      MESSAGE_VARIANTS[Math.floor(Math.random() * MESSAGE_VARIANTS.length)]!;
    const { title, body } = variant;

    const accessToken = await getGoogleAccessToken();

    const { success, failed, uniqueTokens: uniqueTokenCount, invalidTokens } =
      await sendToTokens(
        accessToken,
        firebaseProjectId,
        tokens,
        title,
        body,
      );

    let tokensCleanedUp = 0;
    let cleanupError: string | null = null;
    if (invalidTokens.length > 0) {
      const del = await deleteFcmTokensByValue(supabase, invalidTokens);
      tokensCleanedUp = del.deletedAttempt;
      cleanupError = del.error;
      if (cleanupError) {
        console.error("[daily-vibes] failed to delete invalid fcm_tokens:", cleanupError);
      }
    }

    console.log(
      `[daily-vibes] FCM: sent=${success} failed_non_unreg=${
        failed - invalidTokens.length
      } invalid_unregistered=${invalidTokens.length} tokens_removed=${tokensCleanedUp} variant="${title}"`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        sent: success,
        failed,
        totalTokens: uniqueTokenCount,
        invalidTokensDetected: invalidTokens.length,
        tokensCleanedUp,
        variantTitle: title,
        ...(cleanupError ? { cleanupError } : {}),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[daily-vibes] error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
