
async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: "Database or GitHub secret is missing." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const cookies = (request.headers.get("Cookie") || "").split(";");

    const sessionCookie = cookies
      .map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith("editorial_session="));

    if (!sessionCookie) {
      return Response.json(
        { ok: false, message: "Please log in first." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const token = sessionCookie.substring("editorial_session=".length);

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json(
        { ok: false, message: "Invalid login session." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const tokenHash = await sha256(token);

    const session = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          sessions.id AS session_id,
          sessions.expires_at,
          users.id AS user_id,
          users.role,
          users.is_active
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        LIMIT 1
      `)
      .bind(tokenHash)
      .first();

    if (
      !session ||
      Number(session.is_active) !== 1 ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return Response.json(
        { ok: false, message: "Your login session has expired." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (session.role !== "admin") {
      return Response.json(
        { ok: false, message: "Administrator access required." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const response = await fetch(
      "https://api.github.com/repos/draftlaw-research/draftlaw-research.github.io",
      {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DraftLaw-Editorial-Portal"
        }
      }
    );

    if (!response.ok) {
      let message = "GitHub connection could not be verified.";

      if (response.status === 401) {
        message = "GitHub rejected the token. Check that it is correct.";
      } else if (response.status === 403) {
        message = "GitHub denied access. Check the token permissions.";
      } else if (response.status === 404) {
        message = "Repository not found or the token cannot access it.";
      }

      return Response.json(
        { ok: false, message },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const repository = await response.json();

    return Response.json(
      {
        ok: true,
        message: "GitHub connection successful.",
        repository: repository.full_name,
        defaultBranch: repository.default_branch
      },
      { headers: { "Cache-Control": "no-store" } }
    );

  } catch (error) {
    console.error("GitHub connection test failed:", error);

    return Response.json(
      { ok: false, message: "Unable to test the GitHub connection." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
