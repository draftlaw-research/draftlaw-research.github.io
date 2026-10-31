
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";

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
  `).bind(tokenHash).first();

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

async function hasProgramsPermission(user, env) {
  // Administrators automatically have access.
  if (user.role === "admin") {
    return true;
  }

  const permission = await env.EDITORIAL_DB.prepare(`
    SELECT 1
    FROM editor_section_permissions
    WHERE user_id = ?
      AND section_key = 'programs'
    LIMIT 1
  `).bind(user.id).first();

  return Boolean(permission);
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? "").trim());
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "The program publishing service is not configured."
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Verify the logged-in user.
    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an editor or administrator account."
        },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Editors must have Programs permission.
    // Administrators automatically have access.
    const authorized = await hasProgramsPermission(user, env);

    if (!authorized) {
      return Response.json(
        {
          ok: false,
          message: "You are not authorized to publish programs."
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return Response.json(
        { ok: false, message: "The submitted form data is invalid." },
        { status: 400 }
      );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return Response.json(
        { ok: false, message: "The submitted form data is invalid." },
        { status: 400 }
      );
    }

    const title = typeof data.title === "string" ? data.title.trim() : "";
    const summary = typeof data.summary === "string" ? data.summary.trim() : "";
    const status = typeof data.status === "string" ? data.status.trim() : "Ongoing";
    const body = typeof data.body === "string" ? data.body.trim() : "";
    const orderInput = String(data.order ?? "").trim();

    if (!title || title.length > 250) {
      return Response.json(
        { ok: false, message: "Enter a program name of no more than 250 characters." },
        { status: 400 }
      );
    }

    if (!summary || summary.length > 400) {
      return Response.json(
        { ok: false, message: "Enter a summary of no more than 400 characters." },
        { status: 400 }
      );
    }

    if (body.length > 1000000) {
      return Response.json(
        { ok: false, message: "The program description must not exceed 1 MB." },
        { status: 400 }
      );
    }

    const allowedStatuses = [
      "Open for applications",
      "Upcoming",
      "Ongoing",
      "Closed"
    ];

    if (!allowedStatuses.includes(status)) {
      return Response.json(
        { ok: false, message: "Select a valid program status." },
        { status: 400 }
      );
    }

    let orderValue = null;

    if (orderInput !== "") {
      orderValue = Number(orderInput);

      if (!Number.isFinite(orderValue)) {
        return Response.json(
          { ok: false, message: "Display order must be a valid number." },
          { status: 400 }
        );
      }
    }

    const slug = slugify(title);

    if (!slug) {
      return Response.json(
        {
          ok: false,
          message: "The program name must contain at least one letter or number."
        },
        { status: 400 }
      );
    }

    const path = `src/content/programs/${slug}.md`;
    const url = `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    const githubHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DraftLaw-Editorial-Portal"
    };

    // Prevent accidental replacement of an existing program.
    const existingResponse = await fetch(url, {
      headers: githubHeaders
    });

    if (existingResponse.ok) {
      return Response.json(
        {
          ok: false,
          message: "A program with this name already exists. Please use a different name."
        },
        {
          status: 409,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    if (existingResponse.status !== 404) {
      throw new Error("GitHub could not check whether this program already exists.");
    }

    const frontmatter = [
      "---",
      `title: ${yamlString(title)}`,
      `summary: ${yamlString(summary)}`,
      `status: ${yamlString(status)}`,
      ...(orderValue === null ? [] : [`order: ${orderValue}`]),
      "---",
      ""
    ].join("\n");

    // The Tiptap editor's Markdown output is saved as the content body.
    const content = frontmatter + (body ? `${body}\n` : "");

    const publishResponse = await fetch(url, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Publish program: ${title}`,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: BRANCH
      })
    });

    const publishResult = await publishResponse.json();

    if (!publishResponse.ok) {
      throw new Error(
        publishResult.message || "GitHub could not publish the program."
      );
    }

    return Response.json(
      {
        ok: true,
        title,
        path,
        message: "Program published to GitHub. The website will update after deployment finishes."
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Program creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to publish this program."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
