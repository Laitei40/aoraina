/**
 * GET /stream/:token
 *
 * Streams the audio stored in R2 to the browser, with basic Range support so
 * that the HTMLAudioElement can seek within the file.
 */

export const onRequestGet = async ({ request, params, env }) => {
  const { token } = params;
  if (!token) {
    return new Response("This audio is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const key = `audio/${token}`;

  // First, get head so we know the size and content type.
  const head = await env.AUDIO_BUCKET.head(key);
  if (!head) {
    return new Response("This audio is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const size = head.size;
  const contentType = head.httpMetadata?.contentType || "audio/mpeg";

  const rangeHeader = request.headers.get("Range");

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return new Response("Invalid range", { status: 416 });
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end >= size || start > end) {
      return new Response("Invalid range", { status: 416 });
    }

    const length = end - start + 1;

    const object = await env.AUDIO_BUCKET.get(key, {
      range: { offset: start, length },
    });

    if (!object || !object.body) {
      return new Response("This audio is no longer available.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");

    return new Response(object.body, {
      status: 206,
      headers,
    });
  }

  // Full-object response (no Range header)
  const object = await env.AUDIO_BUCKET.get(key);

  if (!object || !object.body) {
    return new Response("This audio is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(object.size));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");

  return new Response(object.body, {
    status: 200,
    headers,
  });
}
