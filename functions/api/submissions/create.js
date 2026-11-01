
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";

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

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function makeSlug(title) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");

  return slug || `content-${crypto.randomUUID().slice(0, 8)}`;
}

function makeMarkdown(content) {
  const lines = [
    "---",
    `title: ${yamlString(content.title)}`,
    `summary: ${yamlString(content.summary)}`,
    "authors:",
    ...content.authors.map(author => `  - ${yamlString(author)}`)
  ];

  if (content.topic) {
    lines.push(`topic: ${yamlString(content.topic)}`);
  }

  lines.push(
    `kind: ${yamlString(content.kind)}`,
    `date: ${content.date}`,
    `cover: ${yamlString(content.cover || "")}`,
    `coverAlt: ${yamlString(content.coverAlt || "")}`,
    `coverCredit: ${yamlString(content.coverCredit || "")}`,
    `featured: ${content.featured === true}`,
    "keywords:"
  );

  for (const keyword of content.keywords || []) {
    lines.push(`  - ${yamlString(keyword)}`);
  }

  lines.push(
    `peerReviewed: ${content.peerReviewed !== false}`,
    "---",
    "",
    content.body || ""
  );

  return lines.join("\n");
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

function decodeGithubBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

async function githubRequest(path, token) {
  return fetch(
    `https://api.github.com/repos/${REPOSITORY}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DraftLaw-Editorial-Portal"
      }
    }
  );
}

async function getExistingCommitSha(path, token) {
  const response = await githubRequest(
    `commits?path=${encodeURIComponent(path)}&sha=${BRANCH}&per_page=1`,
    token
  );

  if (!response.ok) {
    console.error(
      "GitHub commit lookup failed:",
      await response.text()
    );
    return null;
  }

  const commits = await response.json();

  return Array.isArray(commits)
    ? commits[0]?.sha || null
    : null;
}

async function publishToGithub(content, token) {
  const collection = content.contentType === "article"
    ? "articles"
    : "guides";

  const githubPath =
    `src/content/${collection}/${makeSlug(content.title)}.md`;

  const markdown = makeMarkdown(content);

  const existingResponse = await githubRequest(
    `contents/${githubPath}?ref=${BRANCH}`,
    token
  );

  if (existingResponse.status === 200) {
    const existingFile = await existingResponse.json();

    if (
      existingFile.encoding !== "base64" ||
      typeof existingFile.content !== "string"
    ) {
      throw new Error(
        "GitHub returned an unsupported existing file format."
      );
    }

    const existingMarkdown = decodeGithubBase64(
      existingFile.content
    );

    if (existingMarkdown !== markdown) {
      const error = new Error(
        "A different file already exists with this title. Please change the title or resolve the filename conflict."
      );
      error.status = 409;
      throw error;
    }

    return {
      githubPath,
      githubCommitSha: await getExistingCommitSha(
        githubPath,
        token
      )
    };
  }

  if (existingResponse.status !== 404) {
    console.error(
      "GitHub destination check failed:",
      await existingResponse.text()
    );

    const error = new Error(
      "Could not check the publishing destination on GitHub."
    );
    error.status = 502;
    throw error;
  }

  const publishResponse = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/contents/${githubPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DraftLaw-Editorial-Portal"
      },
      body: JSON.stringify({
        message: `Publish ${content.contentType}: ${content.title}`,
        content: encodeBase64(markdown),
        branch: BRANCH
      })
    }
  );

  const result = await publishResponse.json();

  if (!publishResponse.ok) {
    console.error("GitHub publish failed:", result);

    const error = new Error(
      "GitHub could not publish this content."
    );
    error.status = 502;
    throw error;
  }

  return {
    githubPath,
    githubCommitSha: result.commit?.sha || null
  };
}

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB) {
      return jsonResponse(
        {
          ok: false,
          message: "Submission storage is not configured."
        },
        500
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return jsonResponse(
        {
          ok: false,
          message: "Please log in to continue."
        },
        401
      );
    }

    const data = await request.json();
    const content = validateSubmission(data);

    const requiredSection =
      content.contentType === "article" ? "articles" : "guides";

    const authorized = await hasSectionPermission(
      user,
      env,
      requiredSection
    );

    if (!authorized) {
      return jsonResponse(
        {
          ok: false,
          message: `You do not have permission to create ${content.contentType} submissions. Please contact an administrator.`
        },
        403
      );
    }

    const requestedStatus = data.status || "draft";

    if (!["draft", "pending"].includes(requestedStatus)) {
      return jsonResponse(
        {
          ok: false,
          message: "Invalid submission status."
        },
        400
      );
    }

    if (user.role === "admin" && requestedStatus === "pending" && !env.GITHUB_TOKEN) {
      return jsonResponse(
        {
          ok: false,
          message: "Direct publishing is not configured. Please contact the site administrator."
        },
        500
      );
    }

    const now = new Date().toISOString();
    const submissionId = crypto.randomUUID();

    // Admins publish immediately when they submit for publication.
    // Editors continue to use the pending review workflow.
    const publishDirectly =
      user.role === "admin" && requestedStatus === "pending";

    let finalStatus = requestedStatus;
    let githubPath = null;
    let githubCommitSha = null;
    let publishedAt = null;

    if (publishDirectly) {
      try {
        const githubResult = await publishToGithub(
          content,
          env.GITHUB_TOKEN
        );

        githubPath = githubResult.githubPath;
        githubCommitSha = githubResult.githubCommitSha;
        finalStatus = "approved";
        publishedAt = now;

      } catch (error) {
        console.error("Administrator direct publishing failed:", error);

        return jsonResponse(
          {
            ok: false,
            message: error.message ||
              "Unable to publish this content.",
          },
          error.status || 502
        );
      }
    }

    const contentJson = JSON.stringify(content);
    const title = content.title;
    const typeLabel =
      content.contentType === "article" ? "Article" : "Guide";

    const activityDetails = JSON.stringify({
      title,
      contentType: content.contentType,
      status: finalStatus,
      githubPath,
      githubCommitSha,
      directPublish: publishDirectly
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
          github_path,
          github_commit_sha,
          submitted_at,
          published_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        submissionId,
        user.id,
        content.contentType,
        title,
        contentJson,
        finalStatus,
        githubPath,
        githubCommitSha,
        requestedStatus === "pending" ? now : null,
        publishedAt,
        now,
        now
      )
    );

    let activityAction;

    if (publishDirectly) {
      activityAction = "admin_content_published";
    } else if (finalStatus === "pending") {
      activityAction = "submission_created_and_submitted";
    } else {
      activityAction = "submission_draft_created";
    }

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
        activityAction,
        content.contentType,
        submissionId,
        activityDetails,
        now
      )
    );

    // Only notify administrators when an editor submits for review.
    if (finalStatus === "pending") {
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

    let message;

    if (publishDirectly) {
      message = "Your content has been published successfully.";
    } else if (finalStatus === "pending") {
      message = "Your submission has been sent for approval.";
    } else {
      message = "Your draft has been saved.";
    }

    return jsonResponse(
      {
        ok: true,
        message,
        submission: {
          id: submissionId,
          title,
          contentType: content.contentType,
          status: finalStatus,
          githubPath,
          githubCommitSha,
          publishedAt,
          createdAt: now
        }
      },
      201
    );

  } catch (error) {
    console.error("Submission creation failed:", error);

    return jsonResponse(
      {
        ok: false,
        message: error.message ||
          "Unable to save your submission."
      },
      400
    );
  }
}
