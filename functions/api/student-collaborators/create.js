
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

async function hasStudentCollaboratorsPermission(user, env) {
  // Administrators automatically have access.
  if (user.role === "admin") {
    return true;
  }

  const permission = await env.EDITORIAL_DB.prepare(`
    SELECT 1
    FROM editor_section_permissions
    WHERE user_id = ?
      AND section_key = 'student-collaborators'
    LIMIT 1
  `).bind(user.user_id).first();

  return Boolean(permission);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? "").trim());
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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "The Student Collaborators publishing service is not configured."
        },
        { status: 500 }
      );
    }

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

    // Check permission before accepting or processing profile data.
    const authorized = await hasStudentCollaboratorsPermission(user, env);

    if (!authorized) {
      return Response.json(
        {
          ok: false,
          message: "You are not authorized to publish Student Collaborator profiles."
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const position = String(data.position || "").trim();

    if (!name) {
      return Response.json(
        { ok: false, message: "Full name is required." },
        { status: 400 }
      );
    }

    if (!position) {
      return Response.json(
        { ok: false, message: "Role as Student Collaborator is required." },
        { status: 400 }
      );
    }

    const slug = slugify(name);

    if (!slug) {
      return Response.json(
        { ok: false, message: "Please enter a valid full name." },
        { status: 400 }
      );
    }

    const values = {
      name,
      position,
      occupation: String(data.occupation || "").trim(),
      affiliation: String(data.affiliation || "").trim(),
      photo: String(data.photo || "").trim(),
      linkedin: String(data.linkedin || "").trim(),
      facebook: String(data.facebook || "").trim(),
      instagram: String(data.instagram || "").trim(),
      website: String(data.website || "").trim(),
      body: String(data.body || "").trim()
    };

    for (const field of ["linkedin", "facebook", "instagram", "website"]) {
      if (values[field] && !/^https?:\/\//i.test(values[field])) {
        return Response.json(
          {
            ok: false,
            message: `Please enter a complete URL for ${field}.`
          },
          { status: 400 }
        );
      }
    }

    if (
      values.photo &&
      !/^\/src\/assets\/student-collaborators\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(values.photo)
    ) {
      return Response.json(
        {
          ok: false,
          message: "The selected photo path is not valid."
        },
        { status: 400 }
      );
    }

    const orderInput = String(data.order ?? "").trim();
    let orderValue = null;

    if (orderInput !== "") {
      orderValue = Number(orderInput);

      if (!Number.isFinite(orderValue)) {
        return Response.json(
          {
            ok: false,
            message: "Display order must be a valid number."
          },
          { status: 400 }
        );
      }
    }

    const path = `src/content/student-collaborators/${slug}.md`;

    const headers = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DraftLaw-Editorial-Portal"
    };

    const url = `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    const existing = await fetch(url, { headers });

    if (existing.ok) {
      return Response.json(
        {
          ok: false,
          message: "A Student Collaborator with this name already exists."
        },
        { status: 409 }
      );
    }

    if (existing.status !== 404) {
      throw new Error(
        "GitHub could not check whether this profile already exists."
      );
    }

    const frontmatter = [
      "---",
      `name: ${yamlString(values.name)}`,
      `position: ${yamlString(values.position)}`,
      `occupation: ${yamlString(values.occupation)}`,
      `affiliation: ${yamlString(values.affiliation)}`,
      `photo: ${yamlString(values.photo)}`,
      ...(orderValue === null ? [] : [`order: ${orderValue}`]),
      `linkedin: ${yamlString(values.linkedin)}`,
      `facebook: ${yamlString(values.facebook)}`,
      `instagram: ${yamlString(values.instagram)}`,
      `website: ${yamlString(values.website)}`,
      "---",
      "",
      values.body,
      ""
    ].join("\n");

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Publish Student Collaborator: ${name}`,
        content: btoa(unescape(encodeURIComponent(frontmatter))),
        branch: BRANCH
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || "GitHub could not publish this profile."
      );
    }

    return Response.json(
      {
        ok: true,
        name,
        path,
        message: "Student Collaborator published to GitHub. The website will update after the deployment finishes."
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Student Collaborator creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to publish this profile."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
