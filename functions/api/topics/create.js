
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
  const item = (request.headers.get("Cookie") || "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("editorial_session="));

  return item ? item.slice("editorial_session=".length) : null;
}

async function getLoggedInUser(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const tokenHash = await sha256(token);

  const session = await env.EDITORIAL_DB.prepare(`
    SELECT
      users.id AS user_id,
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

async function hasTopicsPermission(user, env) {
  // Admins automatically have access to every section.
  if (user.role === "admin") {
    return true;
  }

  const permission = await env.EDITORIAL_DB.prepare(`
    SELECT 1
    FROM editor_section_permissions
    WHERE user_id = ?
      AND section_key = 'topics'
    LIMIT 1
  `).bind(user.user_id).first();

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
          message: "The topic publishing service is not configured."
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Verify the logged-in account.
    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        {
          ok: false,
          message: "Please log in with an editor or administrator account."
        },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Verify permission before allowing topic publication.
    const authorized = await hasTopicsPermission(user, env);

    if (!authorized) {
      return Response.json(
        {
          ok: false,
          message: "You do not have permission to publish topics."
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const description = String(data.description || "").trim();
    const orderInput = String(data.order ?? "").trim();

    if (!name) {
      return Response.json(
        { ok: false, message: "Topic name is required." },
        { status: 400 }
      );
    }

    if (!description) {
      return Response.json(
        { ok: false, message: "One-line description is required." },
        { status: 400 }
      );
    }

    const slug = slugify(name);

    if (!slug) {
      return Response.json(
        {
          ok: false,
          message: "Please enter a topic name using letters or numbers."
        },
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

    const path = `src/content/topics/${slug}.md`;

    const githubHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DraftLaw-Editorial-Portal"
    };

    const url =
      `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    // Prevent accidentally replacing an existing topic.
    const existing = await fetch(url, { headers: githubHeaders });

    if (existing.ok) {
      return Response.json(
        {
          ok: false,
          message: "A topic with this name already exists. Please check the Topics list."
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (existing.status !== 404) {
      throw new Error(
        "GitHub could not check whether this topic already exists."
      );
    }

    const frontmatter = [
      "---",
      `name: ${yamlString(name)}`,
      `description: ${yamlString(description)}`,
      ...(orderValue === null ? [] : [`order: ${orderValue}`]),
      "---",
      ""
    ].join("\n");

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Publish topic: ${name}`,
        content: btoa(unescape(encodeURIComponent(frontmatter))),
        branch: BRANCH
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || "GitHub could not publish the topic."
      );
    }

    return Response.json(
      {
        ok: true,
        name,
        path,
        message: "Topic published to GitHub. The website will update after the deployment finishes."
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Topic creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to publish this topic."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
