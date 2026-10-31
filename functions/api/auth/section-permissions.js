
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

  return item
    ? item.substring("editorial_session=".length)
    : null;
}

const CONTENT_SECTIONS = [
  "articles",
  "guides",
  "authors",
  "topics",
  "team",
  "student-collaborators",
  "newsletter",
  "programs",
  "announcements",
  "submit",
  "most-read"
];

export async function onRequestGet({ request, env }) {
  const headers = {
    "Cache-Control": "no-store"
  };

  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        { ok: false, message: "Database is not configured." },
        { status: 500, headers }
      );
    }

    const token = getCookie(request);

    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json(
        { ok: false, message: "Please log in." },
        { status: 401, headers }
      );
    }

    const tokenHash = await sha256(token);

    const user = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          users.id,
          users.username,
          users.role,
          users.is_active,
          sessions.expires_at
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        LIMIT 1
      `)
      .bind(tokenHash)
      .first();

    if (
      !user ||
      Number(user.is_active) !== 1 ||
      new Date(user.expires_at).getTime() <= Date.now()
    ) {
      return Response.json(
        { ok: false, message: "Your session is invalid or expired." },
        { status: 401, headers }
      );
    }

    // Administrators have access to every content section.
    if (user.role === "admin") {
      return Response.json(
        {
          ok: true,
          role: "admin",
          permissions: [...CONTENT_SECTIONS]
        },
        { headers }
      );
    }

    if (user.role !== "editor") {
      return Response.json(
        { ok: false, message: "You cannot access content sections." },
        { status: 403, headers }
      );
    }

    // Retrieve every content permission assigned to this Editor.
    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT section_key
        FROM editor_section_permissions
        WHERE user_id = ?
          AND section_key IN (
            'articles',
            'guides',
            'authors',
            'topics',
            'team',
            'student-collaborators',
            'newsletter',
            'programs',
            'announcements',
            'submit',
            'most-read'
          )
      `)
      .bind(user.id)
      .all();

    const permissions = (result.results || [])
      .map(row => row.section_key);

    return Response.json(
      {
        ok: true,
        role: "editor",
        permissions
      },
      { headers }
    );

  } catch (error) {
    console.error("Section permission check failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to verify section permissions."
      },
      { status: 500, headers }
    );
  }
}
