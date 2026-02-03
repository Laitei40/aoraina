/**
 * GET /api/check/:token
 *
 * Checks whether an audio object exists in R2 for the given token.
 * Returns { exists: boolean, filename?, createdAt?, message? }.
 */

export const onRequestGet = async ({ params, env }) => {
  const { token } = params;
  if (!token) {
    return jsonResponse({ exists: false, message: "This audio is no longer available." }, 404);
  }

  const key = `audio/${token}`;
  const head = await env.AUDIO_BUCKET.head(key);

  if (!head) {
    return jsonResponse({ exists: false, message: "This audio is no longer available." }, 404);
  }

  const filename = head.customMetadata?.filename || "Shared audio";
  const createdAt = head.customMetadata?.createdAt || "";

  return jsonResponse({ exists: true, filename, createdAt }, 200);
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
