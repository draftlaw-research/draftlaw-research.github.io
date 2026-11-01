
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";

const CATEGORIES = [
  "Call for papers",
  "Seminar or conference",
  "Moot court",
  "Fellowship or internship",
  "Other"
];

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

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const tokenHash = await sha256(token);

  const user = await env.EDITORIAL_DB.prepare(`
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
    !user ||
    Number(user.is_active) !== 1 ||
    new Date(user.expires_at).getTime() <= Date.now() ||
    !["admin", "editor"].includes(user.role)
  ) return null;

  return user;
}

async function hasNewsletterPermission(user, env) {
  // Administrators automatically have permission.
  if (user.role === "admin") return true;

  // Editors must have the Newsletter section permission.
  const permission = await env.EDITORIAL_DB.prepare(`
    SELECT 1
    FROM editor_section_permissions
    WHERE user_id = ?
      AND section_key = 'newsletter'
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

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "The Newsletter publishing service is not configured."
        },
        { status: 500 }
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

    // Check Newsletter permission before accepting publishing data.
    const allowed = await hasNewsletterPermission(user, env);

    if (!allowed) {
      return Response.json(
        {
          ok: false,
          message: "You do not have permission to publish Newsletter items."
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const data = await request.json();

    const title = String(data.title || "").trim();
    const category = String(data.category || "Call for papers").trim();
    const organiser = String(data.organiser || "").trim();
    const deadline = String(data.deadline || "").trim();
    const eventDate = String(data.eventDate || "").trim();
    const location = String(data.location || "").trim();
    const link = String(data.link || "").trim();
    const summary = String(data.summary || "").trim();
    const posted = String(data.posted || "").trim();

    if (!title) {
      return Response.json(
        { ok: false, message: "Title is required." },
        { status: 400 }
      );
    }

    if (!CATEGORIES.includes(category)) {
      return Response.json(
        { ok: false, message: "Please select a valid newsletter item type." },
        { status: 400 }
      );
    }

    if (!link) {
      return Response.json(
        { ok: false, message: "Link to the original call is required." },
        { status: 400 }
      );
    }

    try {
      const parsedLink = new URL(link);
      if (!["http:", "https:"].includes(parsedLink.protocol)) throw new Error();
    } catch {
      return Response.json(
        { ok: false, message: "Please enter a valid original call URL beginning with https:// or http://." },
        { status: 400 }
      );
    }

    if (!summary) {
      return Response.json(
        { ok: false, message: "Short description is required." },
        { status: 400 }
      );
    }

    if (summary.length > 500) {
      return Response.json(
        { ok: false, message: "Short description must not exceed 500 characters." },
        { status: 400 }
      );
    }

    if (!isValidDate(posted)) {
      return Response.json(
        { ok: false, message: "Please enter a valid date posted." },
        { status: 400 }
      );
    }

    if (deadline && !isValidDate(deadline)) {
      return Response.json(
        { ok: false, message: "Please enter a valid deadline." },
        { status: 400 }
      );
    }

    if (eventDate && !isValidDate(eventDate)) {
      return Response.json(
        { ok: false, message: "Please enter a valid event date." },
        { status: 400 }
      );
    }

    const slug = slugify(title);

    if (!slug) {
      return Response.json(
        { ok: false, message: "Please enter a title using letters or numbers." },
        { status: 400 }
      );
    }

    const path = `src/content/newsletter/${slug}.md`;

    const headers = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DraftLaw-Editorial-Portal"
    };

    const url = `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    // Do not overwrite an existing newsletter item.
    const existing = await fetch(url, { headers });

    if (existing.ok) {
      return Response.json(
        {
          ok: false,
          message: "A newsletter item with this title already exists. Please use a different title."
        },
        { status: 409 }
      );
    }

    if (existing.status !== 404) {
      throw new Error("GitHub could not check whether this newsletter item already exists.");
    }

    const frontmatter = [
      "---",
      `title: ${yamlString(title)}`,
      `category: ${yamlString(category)}`,
      `organiser: ${yamlString(organiser)}`,
      `deadline: ${yamlString(deadline)}`,
      `eventDate: ${yamlString(eventDate)}`,
      `location: ${yamlString(location)}`,
      `link: ${yamlString(link)}`,
      `summary: ${yamlString(summary)}`,
      `posted: ${yamlString(posted)}`,
      "---",
      ""
    ].join("\n");

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Publish newsletter item: ${title}`,
        content: btoa(unescape(encodeURIComponent(frontmatter))),
        branch: BRANCH
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "GitHub could not publish this newsletter item.");
    }

    return Response.json(
      {
        ok: true,
        title,
        path,
        message: "Newsletter item published to GitHub. The website will update after the deployment finishes."
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Newsletter item creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to publish this newsletter item."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
