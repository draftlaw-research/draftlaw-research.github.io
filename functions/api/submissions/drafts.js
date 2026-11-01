
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

async function getLoggedInUser(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB
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
    !session ||
    Number(session.is_active) !== 1 ||
    new Date(session.expires_at).getTime() <= Date.now() ||
    session.role !== "editor"
  ) {
    return null;
  }

  return session;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        {
          ok: false,
          message: "Submission storage is not configured."
        },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an authorized Editor account."
        },
        { status: 401 }
      );
    }

    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          id,
          content_type,
          title,
          content_json,
          status,
          created_at,
          updated_at
        FROM content_submissions
        WHERE created_by = ?
          AND status = 'draft'
        ORDER BY updated_at DESC
      `)
      .bind(user.id)
      .all();

    const drafts = (result.results || []).map(row => {
      let content = {};

      try {
        content = row.content_json
          ? JSON.parse(row.content_json)
          : {};
      } catch {
        content = {};
      }

      return {
        id: row.id,
        contentType: row.content_type,
        title: row.title,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        content
      };
    });

    return Response.json(
      {
        ok: true,
        drafts
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Loading editor drafts failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load your drafts. Please try again."
      },
      { status: 500 }
    );
  }
}
