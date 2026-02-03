/**
 * DELETE/POST /api/delete/:token
 *
 * Deletes the R2 object associated with the token. Returns { ok: true } even
 * if the object does not exist, so the client can safely clean up state.
 */

export const onRequest = async ({ request, params, env }) => {
  const { token } = params;
  const method = request.method.toUpperCase();

  if (!token) {
    return jsonResponse({ error: "Missing token" }, 400);
  }

  if (method !== "DELETE" && method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const key = `audio/${token}`;

  try {
    await env.AUDIO_BUCKET.delete(key);
  } catch (err) {
    // Best-effort delete; treat as success even if it fails.
  }

  return jsonResponse({ ok: true }, 200);
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
