
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
    !["admin", "editor"].includes(session.role)
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
          message: "Notification storage is not configured."
        },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in to continue."
        },
        { status: 401 }
      );
    }

    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          id,
          submission_id,
          notification_type,
          message,
          is_read,
          created_at
        FROM submission_notifications
        WHERE recipient_user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `)
      .bind(user.id)
      .all();

    const notifications = (result.results || []).map(item => ({
      id: item.id,
      submissionId: item.submission_id,
      type: item.notification_type,
      message: item.message,
      isRead: Number(item.is_read) === 1,
      createdAt: item.created_at
    }));

    const unreadCount = notifications.filter(
      item => !item.isRead
    ).length;

    return Response.json(
      {
        ok: true,
        notifications,
        unreadCount
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Notification retrieval failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to retrieve notifications."
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
