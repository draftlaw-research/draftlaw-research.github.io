
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
    new Date(session.expires_at).getTime() <= Date.now()
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
        {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in to continue."
        },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Only administrators can access the review queue.
    if (user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          message: "Administrator access is required."
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          submissions.id,
          submissions.created_by,
          submissions.content_type,
          submissions.title,
          submissions.content_json,
          submissions.status,
          submissions.submitted_at,
          submissions.created_at,
          submissions.updated_at,
          users.username AS editor_username
        FROM content_submissions AS submissions
        LEFT JOIN users
          ON users.id = submissions.created_by
        WHERE submissions.status = 'pending'
        ORDER BY submissions.submitted_at ASC
      `)
      .all();

    const submissions = (result.results || []).map(item => {
      let content = null;

      try {
        content = item.content_json
          ? JSON.parse(item.content_json)
          : null;
      } catch {
        content = null;
      }

      return {
        id: item.id,
        createdBy: item.created_by,
        editorUsername: item.editor_username || "Unknown editor",
        contentType: item.content_type,
        title: item.title,
        content,
        status: item.status,
        submittedAt: item.submitted_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at
      };
    });

    return Response.json(
      {
        ok: true,
        total: submissions.length,
        submissions
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Submission review queue failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load submissions for review."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
