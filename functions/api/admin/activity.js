
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

  return item ? item.substring("editorial_session=".length) : null;
}

async function isAdministrator(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB
    .prepare(`
      SELECT
        sessions.expires_at,
        users.role,
        users.is_active
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  return Boolean(
    session &&
    Number(session.is_active) === 1 &&
    new Date(session.expires_at).getTime() > Date.now() &&
    session.role === "admin"
  );
}

function getActionLabel(action) {
  const labels = {
    admin_content_published: "Published content directly",
    submission_created_and_submitted: "Submitted content for approval",
    submission_draft_created: "Created a draft",
    submission_draft_updated: "Updated a draft",
    submission_draft_updated_and_submitted: "Updated and resubmitted content",
    submission_rejected_updated: "Updated rejected content",
    submission_rejected_updated_and_resubmitted: "Revised and resubmitted rejected content",
    submission_approved_and_published: "Approved and published content",
    submission_rejected: "Rejected a submission"
  };

  return labels[action] || action.replace(/_/g, " ");
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        {
          ok: false,
          message: "Editorial database is not configured."
        },
        { status: 500 }
      );
    }

    const authorised = await isAdministrator(request, env);

    if (!authorised) {
      return Response.json(
        {
          ok: false,
          message: "Administrator access required."
        },
        { status: 403 }
      );
    }

    const result = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          activity.id,
          activity.action,
          activity.target_type,
          activity.target_id,
          activity.details_json,
          activity.created_at,
          users.username
        FROM activity_log AS activity
        LEFT JOIN users ON users.id = activity.user_id
        ORDER BY activity.created_at DESC
        LIMIT 100
      `)
      .all();

    const activities = (result.results || []).map(item => {
      let details = {};

      try {
        details = JSON.parse(item.details_json || "{}");
      } catch {
        details = {};
      }

      const contentType =
        details.contentType ||
        item.target_type ||
        "content";

      return {
        id: item.id,
        action: item.action,
        message: getActionLabel(item.action),
        title: details.title || "Untitled content",
        contentType,
        author: item.username || "Unknown user",
        date: item.created_at,
        reason: details.reason || null
      };
    });

    return Response.json(
      {
        ok: true,
        total: activities.length,
        activities
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("Editorial activity request failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load editorial activity."
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
