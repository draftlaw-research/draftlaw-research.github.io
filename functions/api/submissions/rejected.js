
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

async function getLoggedInEditor(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB.prepare(`
    SELECT
      users.id,
      users.role,
      users.is_active,
      sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

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
        { ok: false, message: "The editorial database is not configured." },
        { status: 500 }
      );
    }

    const user = await getLoggedInEditor(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an authorized Editor account."
        },
        { status: 401 }
      );
    }

    const result = await env.EDITORIAL_DB.prepare(`
      SELECT
        submissions.id,
        submissions.title,
        submissions.content_type,
        submissions.created_at,
        submissions.updated_at,

        (
          SELECT json_extract(activity.details_json, '$.reason')
          FROM activity_log AS activity
          WHERE activity.target_id = submissions.id
            AND activity.action = 'submission_rejected'
          ORDER BY activity.created_at DESC
          LIMIT 1
        ) AS rejection_reason,

        (
          SELECT activity.created_at
          FROM activity_log AS activity
          WHERE activity.target_id = submissions.id
            AND activity.action = 'submission_rejected'
          ORDER BY activity.created_at DESC
          LIMIT 1
        ) AS rejected_at

      FROM content_submissions AS submissions

      WHERE submissions.created_by = ?
        AND submissions.status = 'rejected'

      ORDER BY submissions.updated_at DESC
    `).bind(user.id).all();

    const rejected = (result.results || []).map(item => ({
      id: item.id,
      title: item.title,
      contentType: item.content_type,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      rejectedAt: item.rejected_at || item.updated_at,
      rejectionReason: item.rejection_reason || "No rejection reason was recorded."
    }));

    return Response.json(
      {
        ok: true,
        rejected
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Loading rejected submissions failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load your rejected submissions."
      },
      { status: 500 }
    );
  }
}
