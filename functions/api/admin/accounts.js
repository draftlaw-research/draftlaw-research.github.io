
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

async function getAdmin(request, env) {
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
    session.role !== "admin"
  ) {
    return null;
  }

  return session;
}

function jsonError(message, status = 400) {
  return Response.json(
    { ok: false, message },
    {
      status,
      headers: { "Cache-Control": "no-store" }
    }
  );
}

async function createPasswordHash(password) {
  const iterations = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));

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

  const saltHex = Array.from(salt)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  const hashHex = Array.from(new Uint8Array(derived))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

async function recordActivity(
  env,
  adminId,
  action,
  targetId,
  details
) {
  await env.EDITORIAL_DB
    .prepare(`
      INSERT INTO activity_log (
        id,
        user_id,
        action,
        target_type,
        target_id,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      adminId,
      action,
      "user",
      targetId,
      JSON.stringify(details),
      new Date().toISOString()
    )
    .run();
}

// List active-directory editor and moderator accounts.
export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const admin = await getAdmin(request, env);

    if (!admin) {
      return jsonError("Administrator login required.", 403);
    }

    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          id,
          username,
          role,
          is_active,
          display_name,
          profile_image_url,
          created_at
        FROM users
        WHERE role IN ('editor', 'moderator')
          AND username NOT LIKE 'deleted-%'
        ORDER BY role, username
      `)
      .all();

    return Response.json(
      {
        ok: true,
        users: result.results || []
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Account listing failed:", error);
    return jsonError("Unable to load accounts.", 500);
  }
}

// Create an editor or moderator account.
export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const admin = await getAdmin(request, env);

    if (!admin) {
      return jsonError("Administrator login required.", 403);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return jsonError("Invalid request data.");
    }

    const username = String(data.username || "").trim();
    const password = String(data.password || "");
    const role = String(data.role || "");

    if (!/^[A-Za-z0-9._-]{4,30}$/.test(username)) {
      return jsonError(
        "Username must be 4–30 characters and use only letters, numbers, dots, underscores or hyphens."
      );
    }

    if (password.length < 12 || password.length > 128) {
      return jsonError(
        "Password must contain at least 12 characters and no more than 128."
      );
    }

    if (!["editor", "moderator"].includes(role)) {
      return jsonError("Choose a valid account role.");
    }

    const existing = await env.EDITORIAL_DB
      .prepare(`
        SELECT id
        FROM users
        WHERE username = ?
        LIMIT 1
      `)
      .bind(username)
      .first();

    if (existing) {
      return jsonError("That username is already in use.", 409);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await createPasswordHash(password);
    const now = new Date().toISOString();

    await env.EDITORIAL_DB
      .prepare(`
        INSERT INTO users (
          id,
          username,
          password_hash,
          role,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(
        userId,
        username,
        passwordHash,
        role,
        now,
        now
      )
      .run();

    await recordActivity(
      env,
      admin.id,
      "account_created",
      userId,
      { username, role }
    );

    return Response.json(
      {
        ok: true,
        message: "Account created successfully.",
        user: {
          id: userId,
          username,
          role,
          is_active: 1,
          created_at: now
        }
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Account creation failed:", error);
    return jsonError("Unable to create the account.", 500);
  }
}

// Update an editor profile or activate/deactivate an account.
export async function onRequestPatch({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const admin = await getAdmin(request, env);

    if (!admin) {
      return jsonError("Administrator login required.", 403);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return jsonError("Invalid request data.");
    }

    // Update an editor or moderator profile.
    if (data.action === "update_profile") {
      const userId = data.userId;

      if (
        typeof userId !== "string" ||
        !userId.trim() ||
        typeof data.displayName !== "string" ||
        (
          data.profileImageUrl !== undefined &&
          data.profileImageUrl !== null &&
          typeof data.profileImageUrl !== "string"
        )
      ) {
        return jsonError("Invalid profile details.");
      }

      const displayName = data.displayName.trim();
      const profileImageUrl = data.profileImageUrl
        ? data.profileImageUrl.trim()
        : null;

      if (displayName.length > 80) {
        return jsonError("Name must not exceed 80 characters.");
      }

      if (
        profileImageUrl &&
        (
          profileImageUrl.length > 1000 ||
          !/^https:\/\/[^\s]+$/i.test(profileImageUrl)
        )
      ) {
        return jsonError("Invalid profile image address.");
      }

      const target = await env.EDITORIAL_DB
        .prepare(`
          SELECT id, username, role
          FROM users
          WHERE id = ?
            AND role IN ('editor', 'moderator')
            AND username NOT LIKE 'deleted-%'
          LIMIT 1
        `)
        .bind(userId)
        .first();

      if (!target) {
        return jsonError("Account not found.", 404);
      }

      const now = new Date().toISOString();

      await env.EDITORIAL_DB
        .prepare(`
          UPDATE users
          SET display_name = ?,
              profile_image_url = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .bind(
          displayName || null,
          profileImageUrl,
          now,
          userId
        )
        .run();

      await recordActivity(
        env,
        admin.id,
        "profile_updated",
        userId,
        {
          username: target.username,
          role: target.role
        }
      );

      return Response.json(
        {
          ok: true,
          message: "Profile updated successfully."
        },
        {
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Activate or deactivate an editor or moderator account.
    const userId = data.userId;
    const active = data.active;

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof active !== "boolean"
    ) {
      return jsonError("Invalid account details.");
    }

    const target = await env.EDITORIAL_DB
      .prepare(`
        SELECT id, username, role
        FROM users
        WHERE id = ?
          AND role IN ('editor', 'moderator')
          AND username NOT LIKE 'deleted-%'
        LIMIT 1
      `)
      .bind(userId)
      .first();

    if (!target) {
      return jsonError("Account not found.", 404);
    }

    const now = new Date().toISOString();

    await env.EDITORIAL_DB
      .prepare(`
        UPDATE users
        SET is_active = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(active ? 1 : 0, now, userId)
      .run();

    // Invalidate all sessions when an account is deactivated.
    if (!active) {
      await env.EDITORIAL_DB
        .prepare(`
          DELETE FROM sessions
          WHERE user_id = ?
        `)
        .bind(userId)
        .run();
    }

    await recordActivity(
      env,
      admin.id,
      active ? "account_activated" : "account_deactivated",
      userId,
      {
        username: target.username,
        role: target.role
      }
    );

    return Response.json(
      {
        ok: true,
        message: active
          ? "Account activated successfully."
          : "Account deactivated successfully."
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Account update failed:", error);
    return jsonError("Unable to update the account.", 500);
  }
}

// Permanently remove an editor or moderator from the active account directory.
// Historical submissions, published content, notifications and audit records
// are deliberately retained. An anonymised user row preserves their references.
export async function onRequestDelete({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const origin = request.headers.get("Origin");

    if (origin && origin !== new URL(request.url).origin) {
      return jsonError("Invalid request origin.", 403);
    }

    const admin = await getAdmin(request, env);

    if (!admin) {
      return jsonError("Administrator login required.", 403);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return jsonError("Invalid request data.");
    }

    const userId = data.userId;
    const confirmUsername = data.confirmUsername;

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof confirmUsername !== "string" ||
      !confirmUsername.trim()
    ) {
      return jsonError("Account confirmation details are required.");
    }

    if (userId === admin.id) {
      return jsonError("You cannot delete your own administrator account.", 403);
    }

    const target = await env.EDITORIAL_DB
      .prepare(`
        SELECT id, username, role
        FROM users
        WHERE id = ?
          AND role IN ('editor', 'moderator')
          AND username NOT LIKE 'deleted-%'
        LIMIT 1
      `)
      .bind(userId)
      .first();

    if (!target) {
      return jsonError("Account not found or already removed.", 404);
    }

    if (confirmUsername !== target.username) {
      return jsonError(
        "The username confirmation does not match. No changes were made.",
        400
      );
    }

    // Generate an unusable replacement identity and random password.
    // The reserved deleted- prefix keeps this record out of account listings.
    const randomSuffix = crypto.randomUUID()
      .replace(/-/g, "")
      .slice(0, 20);

    const replacementUsername = `deleted-${randomSuffix}`;

    const replacementPasswordBytes =
      crypto.getRandomValues(new Uint8Array(48));

    const replacementPassword = Array.from(replacementPasswordBytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    const replacementPasswordHash =
      await createPasswordHash(replacementPassword);

    const now = new Date().toISOString();

    // D1 batch runs these statements together.
    // The user row remains only as an anonymised historical reference.
    await env.EDITORIAL_DB.batch([
      env.EDITORIAL_DB
        .prepare(`
          DELETE FROM sessions
          WHERE user_id = ?
        `)
        .bind(userId),

      env.EDITORIAL_DB
        .prepare(`
          DELETE FROM editor_section_permissions
          WHERE user_id = ?
        `)
        .bind(userId),

      env.EDITORIAL_DB
        .prepare(`
          UPDATE users
          SET username = ?,
              password_hash = ?,
              is_active = 0,
              display_name = NULL,
              profile_image_url = NULL,
              updated_at = ?
          WHERE id = ?
            AND role IN ('editor', 'moderator')
            AND username = ?
        `)
        .bind(
          replacementUsername,
          replacementPasswordHash,
          now,
          userId,
          target.username
        ),

      env.EDITORIAL_DB
        .prepare(`
          INSERT INTO activity_log (
            id,
            user_id,
            action,
            target_type,
            target_id,
            details_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          admin.id,
          "account_deleted",
          "user",
          userId,
          JSON.stringify({
            username: target.username,
            role: target.role,
            accountAccessRemoved: true,
            historicalSubmissionsPreserved: true,
            publishedContentPreserved: true,
            activityHistoryPreserved: true
          }),
          now
        )
    ]);

    return Response.json(
      {
        ok: true,
        message:
          `The account ${target.username} has been removed. ` +
          "Its submissions, published content and activity history have been preserved."
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Account deletion failed:", error);
    return jsonError("Unable to remove this account. No success was confirmed.", 500);
  }
}
