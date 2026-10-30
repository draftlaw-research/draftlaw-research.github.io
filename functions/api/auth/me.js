
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
    if (!env.EDITORIAL_DB) {
      return Response.json(
        { ok: false, message: "Server configuration incomplete" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Read the login session cookie.
    const cookieHeader = request.headers.get("Cookie") || "";

    const sessionCookie = cookieHeader
      .split(";")
      .map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith("editorial_session="));

    if (!sessionCookie) {
      return Response.json(
        { ok: false, message: "Not logged in" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Extract and validate the session token.
    const token = sessionCookie.substring(
      "editorial_session=".length
    );

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json(
        { ok: false, message: "Invalid session" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Hash the token before looking it up in the database.
    const tokenHash = await sha256(token);

    const session = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          sessions.id AS session_id,
          sessions.expires_at,
          users.id AS user_id,
          users.username,
          users.role,
          users.is_active
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        LIMIT 1
      `)
      .bind(tokenHash)
      .first();

    // Reject missing, expired or inactive sessions.
    if (
      !session ||
      session.is_active !== 1 ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      if (session) {
        await env.EDITORIAL_DB
          .prepare("DELETE FROM sessions WHERE id = ?")
          .bind(session.session_id)
          .run();
      }

      return Response.json(
        { ok: false, message: "Session expired or invalid" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Return the authenticated user's details.
    return Response.json(
      {
        ok: true,
        user: {
          id: session.user_id,
          username: session.username,
          role: session.role
        },
        expiresAt: session.expires_at
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Session verification failed:", error);

    return Response.json(
      { ok: false, message: "Unable to verify session" },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
