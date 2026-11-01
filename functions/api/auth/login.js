
function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hash format");
  }

  return new Uint8Array(
    hex.match(/.{2}/g).map(byte => parseInt(byte, 16))
  );
}

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split("$");

  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = Number(parts[1]);

  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) {
    return false;
  }

  const salt = hexToBytes(parts[2]);
  const expectedHash = hexToBytes(parts[3]);

  if (salt.length !== 16 || expectedHash.length !== 32) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  const actualHash = new Uint8Array(derived);

  let difference = 0;

  for (let i = 0; i < actualHash.length; i++) {
    difference |= actualHash[i] ^ expectedHash[i];
  }

  return difference === 0;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        { ok: false, message: "Server configuration incomplete" },
        { status: 500 }
      );
    }

    const body = await request.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (
      username.length < 4 ||
      username.length > 30 ||
      password.length < 1 ||
      password.length > 128
    ) {
      return Response.json(
        { ok: false, message: "Invalid username or password" },
        { status: 400 }
      );
    }

    const user = await env.EDITORIAL_DB
      .prepare(`
        SELECT id, username, password_hash, role, is_active
        FROM users
        WHERE username = ?
        LIMIT 1
      `)
      .bind(username)
      .first();

    if (!user || user.is_active !== 1) {
      return Response.json(
        { ok: false, message: "Invalid username or password" },
        { status: 401 }
      );
    }

    const passwordIsValid = await verifyPassword(
      password,
      user.password_hash
    );

    if (!passwordIsValid) {
      return Response.json(
        { ok: false, message: "Invalid username or password" },
        { status: 401 }
      );
    }

    const token = createToken();
    const tokenHash = await sha256(token);
    const sessionId = crypto.randomUUID();

    const expiresAt = new Date(
      Date.now() + 8 * 60 * 60 * 1000
    ).toISOString();

    await env.EDITORIAL_DB
      .prepare(`
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(sessionId, user.id, tokenHash, expiresAt)
      .run();

    return Response.json(
      {
        ok: true,
        message: "Login successful",
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": `editorial_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`,
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("Login failed:", error);

    return Response.json(
      { ok: false, message: "Unable to complete login" },
      { status: 500 }
    );
  }
}
