
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request) {
  const cookies = (request.headers.get("Cookie") || "").split(";");

  const item = cookies
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("editorial_session="));

  return item ? item.substring("editorial_session=".length) : null;
}

async function isAdministrator(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB
    .prepare(`
      SELECT
        sessions.expires_at,
        users.role,
        users.is_active
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  return Boolean(
    session &&
    Number(session.is_active) === 1 &&
    new Date(session.expires_at).getTime() > Date.now() &&
    session.role === "admin"
  );
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "Required server settings are missing."
        },
        { status: 500 }
      );
    }

    const authorised = await isAdministrator(request, env);

    if (!authorised) {
      return Response.json(
        {
          ok: false,
          message: "Administrator access required."
        },
        { status: 403 }
      );
    }

    const url = new URL(
      `https://api.github.com/repos/${REPOSITORY}/commits`
    );

    url.searchParams.set("sha", BRANCH);
    url.searchParams.set("per_page", "50");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DraftLaw-Editorial-Portal"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("GitHub activity request failed:", data);

      return Response.json(
        {
          ok: false,
          message: "GitHub could not provide the activity history."
        },
        { status: 502 }
      );
    }

    const activities = Array.isArray(data)
      ? data.map(commit => ({
          sha: commit.sha || "",
          message: String(commit.commit?.message || "").split("\n")[0],
          author:
            commit.author?.login ||
            commit.commit?.author?.name ||
            "Unknown contributor",
          date:
            commit.commit?.author?.date ||
            commit.commit?.committer?.date ||
            "",
          url: commit.html_url || ""
        }))
      : [];

    return Response.json(
      {
        ok: true,
        branch: BRANCH,
        total: activities.length,
        activities
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("Activity log error:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load the Activity Log."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
