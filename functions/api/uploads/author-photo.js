const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";
const MAX_FILE_SIZE = 200 * 1024;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function getCookie(request) {
  const item = (request.headers.get("Cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith("editorial_session="));
  return item ? item.slice("editorial_session=".length) : null;
}
async function isEditor(request, env) {
  const token = getCookie(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const hash = await sha256(token);
  const session = await env.EDITORIAL_DB.prepare(`SELECT users.role, users.is_active, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? LIMIT 1`).bind(hash).first();
  return Boolean(session && Number(session.is_active) === 1 && new Date(session.expires_at).getTime() > Date.now() && ["admin", "editor"].includes(session.role));
}
function imageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) return Response.json({ ok: false, message: "Photo upload is not configured." }, { status: 500 });
    if (!(await isEditor(request, env))) return Response.json({ ok: false, message: "Please log in with an editor or administrator account." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("photo");
    if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) return Response.json({ ok: false, message: "Choose a photo first." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ ok: false, message: "The photo is still larger than 200 KB after compression. Please choose another image." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes);
    if (!extension) return Response.json({ ok: false, message: "Use a JPEG, PNG or WebP image." }, { status: 400 });
    const filename = `author-${crypto.randomUUID()}.${extension}`;
    const path = `src/assets/authors/${filename}`;
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DraftLaw-Editorial-Portal", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Add author photo ${filename}`, content: toBase64(bytes), branch: BRANCH })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "GitHub could not save the photo.");
    return Response.json({ ok: true, photo: `/src/assets/authors/${filename}`, message: "Photo uploaded." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Author photo upload failed:", error);
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Unable to upload the photo." }, { status: 500 });
  }
}
