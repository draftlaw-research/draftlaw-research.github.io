
const ALLOWED_TYPES = {
  article: [
    "Article",
    "Case summary",
    "Commentary",
    "Opinion",
    "Book review"
  ],
  guide: [
    "Research Guide",
    "Writing Guide",
    "Moot Court Guide",
    "Academic Skills",
    "Other"
  ]
};

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

// Check whether an Editor has permission for the requested section.
// Administrators automatically have access.
async function hasSectionPermission(user, env, section) {
  if (user.role === "admin") {
    return true;
  }

  if (user.role !== "editor") {
    return false;
  }

  const permission = await env.EDITORIAL_DB
    .prepare(`
      SELECT 1
      FROM editor_section_permissions
      WHERE user_id = ?
        AND section_key = ?
      LIMIT 1
    `)
    .bind(user.id, section)
    .first();

  return Boolean(permission);
}

function validReference(value, prefix) {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.endsWith(".md") &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

function validateSubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid submission data.");
  }

  const contentType = data.contentType;

  if (!Object.hasOwn(ALLOWED_TYPES, contentType)) {
    throw new Error("Choose either Article or Guide.");
  }

  const title = data.title;
  const summary = data.summary;
  const body = data.body;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 250
  ) {
    throw new Error("Enter a title of no more than 250 characters.");
  }

  if (
    typeof summary !== "string" ||
    !summary.trim() ||
    summary.trim().length > 400
  ) {
    throw new Error("Enter a summary of no more than 400 characters.");
  }

  if (
    typeof body !== "string" ||
    !body.trim() ||
    body.length > 1000000
  ) {
    throw new Error("Enter the content. The maximum size is 1 MB.");
  }

  if (
    !Array.isArray(data.authors) ||
    data.authors.length === 0 ||
    data.authors.length > 20 ||
    !data.authors.every(author =>
      validReference(author, "src/content/authors/")
    )
  ) {
    throw new Error("Select at least one valid author.");
  }

  if (
    contentType === "article" &&
    !validReference(data.topic, "src/content/topics/")
  ) {
    throw new Error("Select a topic for the Article.");
  }

  if (
    contentType === "guide" &&
    data.topic &&
    !validReference(data.topic, "src/content/topics/")
  ) {
    throw new Error("Select a valid topic.");
  }

  const kind = data.kind || ALLOWED_TYPES[contentType][0];

  if (!ALLOWED_TYPES[contentType].includes(kind)) {
    throw new Error("Invalid content type.");
  }

  const date = data.date;

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Enter a valid publication date.");
  }

  const keywords = data.keywords ?? [];

  if (
    !Array.isArray(keywords) ||
    keywords.length > 30 ||
    !keywords.every(item =>
      typeof item === "string" && item.trim().length <= 80
    )
  ) {
    throw new Error("Check the keywords.");
  }

  for (const field of ["coverAlt", "coverCredit"]) {
    if (
      data[field] !== undefined &&
      data[field] !== null &&
      typeof data[field] !== "string"
    ) {
      throw new Error(`Invalid ${field} value.`);
    }

    if (
      typeof data[field] === "string" &&
      data[field].length > 1000
    ) {
      throw new Error(`${field} is too long.`);
    }
  }

  const cover = data.cover || "";

  const isLegacyCover =
    typeof cover === "string" &&
    /^\/src\/assets\/covers\/editorial-[a-f0-9-]+\.(jpg|png|webp)$/i.test(cover);

  const isGithubCover =
    typeof cover === "string" &&
    /^https:\/\/raw\.githubusercontent\.com\/draftlaw-research\/draftlaw-research\.github\.io\/(?:editorial-portal-development|refs\/heads\/editorial-portal-development)\/public\/uploads\/editorial-[a-f0-9-]+\.(jpg|png|webp)$/i.test(cover);

  if (
    typeof cover !== "string" ||
    (cover !== "" && !isLegacyCover && !isGithubCover)
  ) {
    throw new Error("Invalid cover image path.");
  }

  if (
    data.featured !== undefined &&
    typeof data.featured !== "boolean"
  ) {
    throw new Error("Invalid Featured setting.");
  }

  if (
    data.peerReviewed !== undefined &&
    typeof data.peerReviewed !== "boolean"
  ) {
    throw new Error("Invalid peer review setting.");
  }

  return {
    contentType,
    title: title.trim(),
    summary: summary.trim(),
    authors: [...new Set(data.authors)],
    topic: data.topic || null,
    kind,
    date,
    cover,
    coverAlt: data.coverAlt || "",
    coverCredit: data.coverCredit || "",
    featured: data.featured === true,
    keywords: keywords.map(item => item.trim()).filter(Boolean),
    peerReviewed: data.peerReviewed !== false,
    body: body.trim()
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return Response.json(
        {
          ok: false,
          message: "Submission storage is not configured."
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in to continue."
        },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const data = await request.json();
    const content = validateSubmission(data);

    // Match the requested submission type to its permission section.
    const requiredSection =
      content.contentType === "article" ? "articles" : "guides";

    const authorized = await hasSectionPermission(
      user,
      env,
      requiredSection
    );

    if (!authorized) {
      return Response.json(
        {
          ok: false,
          message: `You do not have permission to create ${content.contentType} submissions. Please contact an administrator.`
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const requestedStatus = data.status || "draft";

    if (!["draft", "pending"].includes(requestedStatus)) {
      return Response.json(
        {
          ok: false,
          message: "Invalid submission status."
        },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const submissionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const contentJson = JSON.stringify(content);

    const title = content.title;
    const typeLabel =
      content.contentType === "article" ? "Article" : "Guide";

    const activityDetails = JSON.stringify({
      title,
      contentType: content.contentType,
      status: requestedStatus
    });

    const statements = [];

    statements.push(
      env.EDITORIAL_DB.prepare(`
        INSERT INTO content_submissions (
          id,
          created_by,
          content_type,
          title,
          content_json,
          status,
          submitted_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        submissionId,
        user.id,
        content.contentType,
        title,
        contentJson,
        requestedStatus,
        requestedStatus === "pending" ? now : null,
        now,
        now
      )
    );

    statements.push(
      env.EDITORIAL_DB.prepare(`
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
      `).bind(
        crypto.randomUUID(),
        user.id,
        requestedStatus === "pending"
          ? "submission_created_and_submitted"
          : "submission_draft_created",
        content.contentType,
        submissionId,
        activityDetails,
        now
      )
    );

    if (requestedStatus === "pending") {
      const admins = await env.EDITORIAL_DB
        .prepare(`
          SELECT id
          FROM users
          WHERE role = 'admin'
            AND is_active = 1
        `)
        .all();

      for (const admin of admins.results || []) {
        statements.push(
          env.EDITORIAL_DB.prepare(`
            INSERT INTO submission_notifications (
              id,
              recipient_user_id,
              submission_id,
              notification_type,
              message,
              is_read,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `).bind(
            crypto.randomUUID(),
            admin.id,
            submissionId,
            "new_submission",
            `A new ${typeLabel} titled "${title}" is waiting for your review.`,
            now
          )
        );
      }
    }

    await env.EDITORIAL_DB.batch(statements);

    return Response.json(
      {
        ok: true,
        message: requestedStatus === "pending"
          ? "Your submission has been sent for approval."
          : "Your draft has been saved.",
        submission: {
          id: submissionId,
          title,
          contentType: content.contentType,
          status: requestedStatus,
          createdAt: now
        }
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Submission creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error.message || "Unable to save your submission."
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
