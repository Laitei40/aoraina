/**
 * POST /api/upload
 *
 * Receives raw audio bytes and stores them in an R2 bucket (AUDIO_BUCKET)
 * under a randomly generated token key. Returns { token }.
 *
 * The front-end sends the file as the request body with headers:
 * - Content-Type: audio mime
 * - X-Filename: encoded original filename
 * - X-Mime-Type: audio mime
 */

export const onRequestPost = async ({ request, env }) => {
  try {
    const maxBytes = 25 * 1024 * 1024; // 25 MB safeguard

    const mimeHeader = request.headers.get("X-Mime-Type") || request.headers.get("Content-Type") || "audio/mpeg";
    const encodedFilename = request.headers.get("X-Filename") || "audio";
    let filename;
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      filename = encodedFilename;
    }

    // Read full body (sufficient for this size cap); for larger files,
    // a streaming approach would be more appropriate.
    const arrayBuffer = await request.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return jsonResponse({ error: "No audio data received" }, 400);
    }

    if (arrayBuffer.byteLength > maxBytes) {
      return jsonResponse({ error: "Audio file too large (max 25 MB)" }, 413);
    }

    const token = crypto.randomUUID();
    const key = `audio/${token}`;
    const createdAt = Date.now().toString();

    await env.AUDIO_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: mimeHeader },
      customMetadata: { filename, createdAt },
    });

    return jsonResponse({ token }, 200);
  } catch (err) {
    return jsonResponse({ error: "Upload failed" }, 500);
  }
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
