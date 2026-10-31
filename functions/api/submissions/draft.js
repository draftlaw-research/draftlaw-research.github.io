
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

async function getLoggedInEditor(request, env) {
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
    session.role !== "editor"
  ) {
    return null;
  }

  return session;
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

  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.trim().length > 250
  ) {
    throw new Error("Enter a title of no more than 250 characters.");
  }

  if (
    typeof data.summary !== "string" ||
    !data.summary.trim() ||
    data.summary.trim().length > 400
  ) {
    throw new Error("Enter a summary of no more than 400 characters.");
  }

  if (
    typeof data.body !== "string" ||
    !data.body.trim() ||
    data.body.length > 1000000
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
    title: data.title.trim(),
    summary: data.summary.trim(),
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
    body: data.body.trim()
  };
}

async function getOwnedDraft(env, id, userId) {
  return await env.EDITORIAL_DB
    .prepare(`
      SELECT
        id,
        created_by,
        content_type,
        title,
        content_json,
        status
      FROM content_submissions
      WHERE id = ?
        AND created_by = ?
        AND status = 'draft'
      LIMIT 1
    `)
    .bind(id, userId)
    .first();
}

// GET: List drafts or load one specific draft.
export async function onRequestGet({ request, env }) {
  try {
    const user = await getLoggedInEditor(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an authorized Editor account."
        },
        { status: 401 }
      );
    }

    const id = new URL(request.url).searchParams.get("id");

    // No ID: return this Editor's draft list.
    if (!id) {
      const result = await env.EDITORIAL_DB
        .prepare(`
          SELECT
            id,
            title,
            content_type,
            created_at,
            updated_at
          FROM content_submissions
          WHERE created_by = ?
            AND status = 'draft'
          ORDER BY updated_at DESC
        `)
        .bind(user.id)
        .all();

      return Response.json(
        {
          ok: true,
          drafts: (result.results || []).map(draft => ({
            id: draft.id,
            title: draft.title,
            contentType: draft.content_type,
            createdAt: draft.created_at,
            updatedAt: draft.updated_at
          }))
        },
        {
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // With an ID: load one draft belonging to this Editor.
    const draft = await getOwnedDraft(env, id, user.id);

    if (!draft) {
      return Response.json(
        {
          ok: false,
          message: "Draft not found or you are not allowed to access it."
        },
        { status: 404 }
      );
    }

    let content;

    try {
      content = JSON.parse(draft.content_json || "{}");
    } catch {
      return Response.json(
        {
          ok: false,
          message: "The saved draft could not be read."
        },
        { status: 500 }
      );
    }

    return Response.json(
      {
        ok: true,
        draft: {
          id: draft.id,
          contentType: draft.content_type,
          title: draft.title,
          content
        }
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Loading drafts failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load your drafts."
      },
      { status: 500 }
    );
  }
}

// PUT: Update a draft or submit it for Admin approval.
export async function onRequestPut({ request, env }) {
  try {
    const user = await getLoggedInEditor(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an authorized Editor account."
        },
        { status: 401 }
      );
    }

    const data = await request.json();

    const id = typeof data.id === "string" ? data.id : "";
    const requestedStatus = data.status || "draft";

    if (!id) {
      return Response.json(
        { ok: false, message: "A draft ID is required." },
        { status: 400 }
      );
    }

    if (!["draft", "pending"].includes(requestedStatus)) {
      return Response.json(
        { ok: false, message: "Invalid submission status." },
        { status: 400 }
      );
    }

    const existing = await getOwnedDraft(env, id, user.id);

    if (!existing) {
      return Response.json(
        {
          ok: false,
          message: "Draft not found or it is no longer editable."
        },
        { status: 404 }
      );
    }

    const content = validateSubmission(data);

    if (content.contentType !== existing.content_type) {
      return Response.json(
        {
          ok: false,
          message: "The content type of an existing draft cannot be changed."
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const contentJson = JSON.stringify(content);
    const typeLabel = content.contentType === "article" ? "Article" : "Guide";

    const update = await env.EDITORIAL_DB
      .prepare(`
        UPDATE content_submissions
        SET
          title = ?,
          content_json = ?,
          status = ?,
          submitted_at = ?,
          updated_at = ?
        WHERE id = ?
          AND created_by = ?
          AND status = 'draft'
      `)
      .bind(
        content.title,
        contentJson,
        requestedStatus,
        requestedStatus === "pending" ? now : null,
        now,
        id,
        user.id
      )
      .run();

    if (!update.meta?.changes) {
      return Response.json(
        {
          ok: false,
          message: "This draft has changed or is no longer editable. Please reload it."
        },
        { status: 409 }
      );
    }

    const statements = [
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
          ? "submission_draft_updated_and_submitted"
          : "submission_draft_updated",
        content.contentType,
        id,
        JSON.stringify({
          title: content.title,
          contentType: content.contentType,
          status: requestedStatus
        }),
        now
      )
    ];

    // Notify active Admins when the Editor submits the updated draft.
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
            id,
            "new_submission",
            `An updated ${typeLabel} titled "${content.title}" is waiting for your review.`,
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
          ? "Your updated submission has been sent for approval."
          : "Your draft has been updated.",
        submission: {
          id,
          title: content.title,
          status: requestedStatus,
          updatedAt: now
        }
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Updating draft failed:", error);

    return Response.json(
      {
        ok: false,
        message: error.message || "Unable to update this draft."
      },
      { status: 400 }
    );
  }
}
