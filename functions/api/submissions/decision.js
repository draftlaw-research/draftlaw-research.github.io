
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "main";

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

async function getLoggedInUser(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB.prepare(`
    SELECT users.id, users.username, users.role, users.is_active,
           sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (
    !session ||
    Number(session.is_active) !== 1 ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  return session;
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

  return slug || `article-${crypto.randomUUID().slice(0, 8)}`;
}

function makeMarkdown(content) {
  const lines = [
    "---",
    `title: ${yamlString(content.title)}`,
    `summary: ${yamlString(content.summary)}`,
    "authors:",
    ...content.authors.map(author => `  - ${yamlString(author)}`)
  ];

  if (content.contentType === "article") {
    lines.push(`topic: ${yamlString(content.topic)}`);
  } else if (content.topic) {
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

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

function decodeGithubBase64(value) {
  const cleaned = String(value || "").replace(/\s/g, "");
  const binary = atob(cleaned);
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

async function getExistingCommitSha(githubPath, token) {
  try {
    const response = await githubRequest(
      `commits?path=${encodeURIComponent(githubPath)}&sha=${BRANCH}&per_page=1`,
      token
    );

    if (!response.ok) {
      console.error(
        "Could not retrieve existing GitHub commit:",
        await response.text()
      );
      return null;
    }

    const commits = await response.json();

    return Array.isArray(commits)
      ? commits[0]?.sha || null
      : null;
  } catch (error) {
    console.error("GitHub commit lookup failed:", error);
    return null;
  }
}

async function getOrCreateGithubFile(githubPath, markdown, token) {
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
      const conflict = new Error(
        "A different content file already exists at the publishing destination. No existing file was overwritten."
      );
      conflict.status = 409;
      throw conflict;
    }

    // The file already exists and exactly matches this submission.
    // This handles a previous attempt that created the GitHub file
    // but failed before updating the D1 record.
    const commitSha = await getExistingCommitSha(
      githubPath,
      token
    );

    return {
      commitSha,
      alreadyExisted: true
    };
  }

  if (existingResponse.status !== 404) {
    console.error(
      "GitHub existence check failed:",
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
        message: `Publish content: ${githubPath}`,
        content: encodeBase64(markdown),
        branch: BRANCH
      })
    }
  );

  const publishResult = await publishResponse.json();

  if (!publishResponse.ok) {
    console.error("GitHub publishing failed:", publishResult);

    const error = new Error(
      "GitHub could not publish this content. The submission remains pending."
    );
    error.status = 502;
    throw error;
  }

  return {
    commitSha: publishResult.commit?.sha || null,
    alreadyExisted: false
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "The editorial publishing service is not configured."
        },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in to continue."
        },
        { status: 401 }
      );
    }

    if (user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          message: "Only administrators can review submissions."
        },
        { status: 403 }
      );
    }

    const data = await request.json();
    const submissionId = data.id;
    const decision = data.decision;
    const reason = typeof data.reason === "string"
      ? data.reason.trim().slice(0, 2000)
      : "";

    if (
      typeof submissionId !== "string" ||
      !/^[A-Za-z0-9-]{10,100}$/.test(submissionId) ||
      !["approve", "reject"].includes(decision)
    ) {
      return Response.json(
        { ok: false, message: "Invalid review request." },
        { status: 400 }
      );
    }

    if (decision === "reject" && !reason) {
      return Response.json(
        {
          ok: false,
          message: "Please provide a reason for rejection."
        },
        { status: 400 }
      );
    }

    const submission = await env.EDITORIAL_DB.prepare(`
      SELECT id, created_by, content_type, title, content_json, status
      FROM content_submissions
      WHERE id = ?
      LIMIT 1
    `).bind(submissionId).first();

    if (!submission) {
      return Response.json(
        { ok: false, message: "Submission not found." },
        { status: 404 }
      );
    }

    if (submission.status !== "pending") {
      return Response.json(
        {
          ok: false,
          message: "This submission has already been reviewed."
        },
        { status: 409 }
      );
    }

    let content;

    try {
      content = JSON.parse(submission.content_json || "{}");
    } catch {
      return Response.json(
        {
          ok: false,
          message: "The saved submission contains invalid data."
        },
        { status: 422 }
      );
    }

    if (
      !["article", "guide"].includes(submission.content_type) ||
      content.contentType !== submission.content_type ||
      typeof content.title !== "string" ||
      !content.title.trim() ||
      !Array.isArray(content.authors) ||
      !content.authors.length ||
      typeof content.body !== "string" ||
      !content.body.trim() ||
      typeof content.summary !== "string" ||
      !content.summary.trim() ||
      typeof content.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(content.date) ||
      !Array.isArray(content.keywords)
    ) {
      return Response.json(
        {
          ok: false,
          message: "The saved submission is incomplete or invalid. It cannot be published."
        },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();

    let githubPath = null;
    let githubCommitSha = null;
    let finalStatus = "rejected";

    if (decision === "approve") {
      const collection = submission.content_type === "article"
        ? "articles"
        : "guides";

      const slug = makeSlug(content.title);
      githubPath = `src/content/${collection}/${slug}.md`;

      const markdown = makeMarkdown(content);

      try {
        const githubResult = await getOrCreateGithubFile(
          githubPath,
          markdown,
          env.GITHUB_TOKEN
        );

        githubCommitSha = githubResult.commitSha;
      } catch (error) {
        console.error("Submission publishing error:", error);

        return Response.json(
          {
            ok: false,
            message: error.message ||
              "Unable to publish this submission."
          },
          { status: error.status || 502 }
        );
      }

      // The D1 CHECK constraint allows "approved", not "published".
      finalStatus = "approved";
    }

    const typeLabel = submission.content_type === "article"
      ? "Article"
      : "Guide";

    const notificationType = decision === "approve"
      ? "submission_approved"
      : "submission_rejected";

    const notificationMessage = decision === "approve"
      ? `Your ${typeLabel.toLowerCase()} "${submission.title}" has been approved and published.`
      : `Your ${typeLabel.toLowerCase()} "${submission.title}" was not approved. Reason: ${reason}`;

    const details = JSON.stringify({
      title: submission.title,
      contentType: submission.content_type,
      decision,
      status: finalStatus,
      reason: decision === "reject" ? reason : null,
      githubPath,
      githubCommitSha
    });

    const updateResult = await env.EDITORIAL_DB.prepare(`
      UPDATE content_submissions
      SET status = ?,
          github_path = ?,
          github_commit_sha = ?,
          published_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
    `).bind(
      finalStatus,
      githubPath,
      githubCommitSha,
      decision === "approve" ? now : null,
      now,
      submissionId
    ).run();

    if (Number(updateResult.meta?.changes || 0) !== 1) {
      return Response.json(
        {
          ok: false,
          message: "The submission changed while it was being reviewed. Please refresh the review page."
        },
        { status: 409 }
      );
    }

    await env.EDITORIAL_DB.batch([
      env.EDITORIAL_DB.prepare(`
        INSERT INTO activity_log (
          id, user_id, action, target_type, target_id,
          details_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        user.id,
        decision === "approve"
          ? "submission_approved_and_published"
          : "submission_rejected",
        submission.content_type,
        submissionId,
        details,
        now
      ),
      env.EDITORIAL_DB.prepare(`
        INSERT INTO submission_notifications (
          id, recipient_user_id, submission_id, notification_type,
          message, is_read, created_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).bind(
        crypto.randomUUID(),
        submission.created_by,
        submissionId,
        notificationType,
        notificationMessage,
        now
      )
    ]);

    return Response.json(
      {
        ok: true,
        message: decision === "approve"
          ? "The submission has been approved and published."
          : "The submission has been rejected and the editor has been notified.",
        status: finalStatus,
        githubPath,
        githubCommitSha
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Submission review failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Something went wrong while reviewing this submission."
      },
      { status: 500 }
    );
  }
}
