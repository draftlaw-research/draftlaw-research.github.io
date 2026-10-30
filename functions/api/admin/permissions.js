
const CONTENT_SECTIONS = [
  "articles",
  "guides",
  "authors",
  "topics",
  "team",
  "student-collaborators",
  "newsletter",
  "programs",
  "announcements",
  "submit",
  "most-read"
];

const MANAGE_PERMISSION = "manage_permissions";

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

async function canManagePermissions(user, env) {
  if (user.role === "admin") {
    return true;
  }

  if (user.role !== "moderator") {
    return false;
  }

  const permission = await env.EDITORIAL_DB
    .prepare(`
      SELECT section_key
      FROM editor_section_permissions
      WHERE user_id = ?
        AND section_key = ?
      LIMIT 1
    `)
    .bind(user.id, MANAGE_PERMISSION)
    .first();

  return Boolean(permission);
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

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return jsonError("Please log in.", 401);
    }

    if (!(await canManagePermissions(user, env))) {
      return jsonError(
        "You are not authorized to manage permissions.",
        403
      );
    }

    let usersQuery;

    if (user.role === "admin") {
      usersQuery = await env.EDITORIAL_DB
        .prepare(`
          SELECT id, username, role, is_active
          FROM users
          ORDER BY role, username
        `)
        .all();
    } else {
      usersQuery = await env.EDITORIAL_DB
        .prepare(`
          SELECT id, username, role, is_active
          FROM users
          WHERE role = 'editor'
          ORDER BY username
        `)
        .all();
    }

    const permissionsQuery = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          editor_section_permissions.user_id,
          editor_section_permissions.section_key,
          editor_section_permissions.granted_by,
          editor_section_permissions.created_at,
          users.username AS granted_by_username
        FROM editor_section_permissions
        LEFT JOIN users
          ON users.id = editor_section_permissions.granted_by
      `)
      .all();

    return Response.json(
      {
        ok: true,
        sections: CONTENT_SECTIONS,
        users: usersQuery.results || [],
        permissions: permissionsQuery.results || [],
        canManagePermissions: true,
        role: user.role
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Permission listing failed:", error);
    return jsonError("Unable to load permissions.", 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonError("Database is not configured.", 500);
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return jsonError("Please log in.", 401);
    }

    if (!(await canManagePermissions(user, env))) {
      return jsonError(
        "You are not authorized to manage permissions.",
        403
      );
    }

    const data = await request.json();

    const userId = data.userId;
    const sectionKey = data.sectionKey;
    const enabled = data.enabled;

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof sectionKey !== "string" ||
      typeof enabled !== "boolean"
    ) {
      return jsonError("Invalid permission details.");
    }

    const isContentPermission =
      CONTENT_SECTIONS.includes(sectionKey);

    const isManagementPermission =
      sectionKey === MANAGE_PERMISSION;

    if (!isContentPermission && !isManagementPermission) {
      return jsonError("Unknown permission section.");
    }

    // Only administrators can grant or revoke permission-management access.
    if (isManagementPermission && user.role !== "admin") {
      return jsonError(
        "Only administrators can change permission-management access.",
        403
      );
    }

    const target = await env.EDITORIAL_DB
      .prepare(`
        SELECT id, role, is_active
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(userId)
      .first();

    if (!target || Number(target.is_active) !== 1) {
      return jsonError("The selected account does not exist or is inactive.", 404);
    }

    // Administrators cannot have their own permissions restricted.
    if (target.role === "admin") {
      return jsonError(
        "Administrator access cannot be changed here.",
        403
      );
    }

    // Moderators can manage editor permissions, not moderator permissions.
    if (user.role === "moderator" && target.role !== "editor") {
      return jsonError(
        "Moderators can manage permissions for editor accounts only.",
        403
      );
    }

    if (enabled) {
      await env.EDITORIAL_DB
        .prepare(`
          INSERT INTO editor_section_permissions (
            user_id,
            section_key,
            granted_by
          )
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, section_key)
          DO UPDATE SET
            granted_by = excluded.granted_by,
            created_at = CURRENT_TIMESTAMP
        `)
        .bind(userId, sectionKey, user.id)
        .run();
    } else {
      await env.EDITORIAL_DB
        .prepare(`
          DELETE FROM editor_section_permissions
          WHERE user_id = ?
            AND section_key = ?
        `)
        .bind(userId, sectionKey)
        .run();
    }

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
        user.id,
        enabled ? "permission_granted" : "permission_revoked",
        "user",
        userId,
        JSON.stringify({
          sectionKey,
          targetRole: target.role
        }),
        new Date().toISOString()
      )
      .run();

    return Response.json(
      {
        ok: true,
        message: enabled
          ? "Permission granted successfully."
          : "Permission revoked successfully."
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Permission update failed:", error);
    return jsonError("Unable to update this permission.", 500);
  }
}
