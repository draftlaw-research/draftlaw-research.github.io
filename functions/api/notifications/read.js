
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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        { ok: false, message: "Notification storage is unavailable." },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        { ok: false, message: "Please log in to continue." },
        { status: 401 }
      );
    }

    const data = await request.json();
    const notificationId = data.id;

    if (
      typeof notificationId !== "string" ||
      !notificationId.trim() ||
      notificationId.length > 100
    ) {
      return Response.json(
        { ok: false, message: "Invalid notification." },
        { status: 400 }
      );
    }

    await env.EDITORIAL_DB
      .prepare(`
        UPDATE submission_notifications
        SET is_read = 1
        WHERE id = ?
          AND recipient_user_id = ?
      `)
      .bind(notificationId, user.id)
      .run();

    return Response.json(
      { ok: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Mark notification as read failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to update notification."
      },
      { status: 500 }
    );
  }
}
