
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 310000,
      hash: "SHA-256"
    },
    key,
    256
  );

  const toHex = (bytes) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return `pbkdf2$310000$${toHex(salt)}$${toHex(
    new Uint8Array(hash)
  )}`;
}

function safeCompare(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);

  if (x.length !== y.length) return false;

  let result = 0;
  for (let i = 0; i < x.length; i++) {
    result |= x[i] ^ y[i];
  }

  return result === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.ADMIN_SETUP_KEY) {
      return Response.json(
        { ok: false, message: "Server configuration incomplete" },
        { status: 500 }
      );
    }

    const suppliedKey = request.headers.get("Authorization") || "";
    const expectedKey = `Bearer ${env.ADMIN_SETUP_KEY}`;

    if (!safeCompare(suppliedKey, expectedKey)) {
      return Response.json(
        { ok: false, message: "Unauthorised" },
        { status: 401 }
      );
    }

    const existing = await env.EDITORIAL_DB
      .prepare("SELECT COUNT(*) AS total FROM users")
      .first();

    if (existing.total > 0) {
      return Response.json(
        { ok: false, message: "Admin setup has already been completed" },
        { status: 409 }
      );
    }

    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!/^[a-zA-Z0-9_-]{4,30}$/.test(username)) {
      return Response.json(
        { ok: false, message: "Username must be 4–30 letters, numbers, underscores or hyphens" },
        { status: 400 }
      );
    }

    if (password.length < 12 || password.length > 128) {
      return Response.json(
        { ok: false, message: "Password must be between 12 and 128 characters" },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();

    await env.EDITORIAL_DB
      .prepare(`
        INSERT INTO users (id, username, password_hash, role)
        VALUES (?, ?, ?, 'admin')
      `)
      .bind(id, username, passwordHash)
      .run();

    return Response.json(
      { ok: true, message: "First admin account created successfully" },
      { status: 201 }
    );
  } catch (error) {
  console.error("Admin setup failed:", error);

  return Response.json(
    {
      ok: false,
      message: "Unable to create admin account",
      diagnostic: error.message || String(error)
    },
    { status: 500 }
  );
}
}
