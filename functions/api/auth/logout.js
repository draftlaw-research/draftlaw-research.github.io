async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost({ request, env }) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const sessionCookie = cookieHeader
    .split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("editorial_session="));

  const clearCookie =
    "editorial_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        { ok: false, message: "Server configuration incomplete" },
        {
          status: 500,
          headers: {
            "Set-Cookie": clearCookie,
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // Reject cross-origin sign-out requests.
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json(
        { ok: false, message: "Invalid request origin" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (sessionCookie) {
      const token = sessionCookie.substring("editorial_session=".length);

      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const tokenHash = await sha256(token);

        await env.EDITORIAL_DB.prepare(
          "DELETE FROM sessions WHERE token_hash = ?"
        ).bind(tokenHash).run();
      }
    }

    return Response.json(
      { ok: true, message: "Signed out successfully" },
      {
        status: 200,
        headers: {
          "Set-Cookie": clearCookie,
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("Sign-out failed:", error);

    return Response.json(
      { ok: false, message: "Unable to complete sign out" },
      {
        status: 500,
        headers: {
          "Set-Cookie": clearCookie,
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
