
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

  return item
    ? item.slice("editorial_session=".length)
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

async function hasSectionPermission(user, env, sectionKey) {
  // Administrators have access to every content section.
  if (user.role === "admin") {
    return true;
  }

  // Editors need an explicit permission for this section.
  const permission = await env.EDITORIAL_DB
    .prepare(`
      SELECT 1
      FROM editor_section_permissions
      WHERE user_id = ?
        AND section_key = ?
      LIMIT 1
    `)
    .bind(user.id, sectionKey)
    .first();

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
          message: "The author publishing service is not configured."
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

    // Check permission to publish in the Authors section.
    const authorized = await hasSectionPermission(
      user,
      env,
      "authors"
    );

    if (!authorized) {
      return Response.json(
        {
          ok: false,
          message: "You are not authorized to publish author profiles."
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    // Read submitted form data.
    const data = await request.json();

    const name = String(data.name || "").trim();

    if (!name) {
      return Response.json(
        { ok: false, message: "Full name is required." },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const slug = slugify(name);

    if (!slug) {
      return Response.json(
        {
          ok: false,
          message: "Please enter a valid full name."
        },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const path = `src/content/authors/${slug}.md`;

    // Collect author profile fields.
    const fields = [
      "role",
      "affiliation",
      "country",
      "photo",
      "orcid",
      "linkedin",
      "facebook",
      "instagram",
      "website"
    ];

    const values = { name };

    for (const field of fields) {
      values[field] = String(data[field] || "").trim();
    }

    // Validate social media and website URLs.
    for (const field of [
      "linkedin",
      "facebook",
      "instagram",
      "website"
    ]) {
      if (
        values[field] &&
        !/^https?:\/\//i.test(values[field])
      ) {
        return Response.json(
          {
            ok: false,
            message: `Please enter a complete URL for ${field}.`
          },
          {
            status: 400,
            headers: { "Cache-Control": "no-store" }
          }
        );
      }
    }

    // Prepare Markdown content.
    const frontmatter = [
      "---",
      `name: ${yamlString(values.name)}`,
      `role: ${yamlString(values.role)}`,
      `affiliation: ${yamlString(values.affiliation)}`,
      `country: ${yamlString(values.country)}`,
      `photo: ${yamlString(values.photo)}`,
      `orcid: ${yamlString(values.orcid)}`,
      `linkedin: ${yamlString(values.linkedin)}`,
      `facebook: ${yamlString(values.facebook)}`,
      `instagram: ${yamlString(values.instagram)}`,
      `website: ${yamlString(values.website)}`,
      "---",
      "",
      String(data.body || "").trim(),
      ""
    ].join("\n");

    const url =
      `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    const githubHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DraftLaw-Editorial-Portal"
    };

    // Check whether an author with this name already exists.
    const existing = await fetch(url, {
      headers: githubHeaders
    });

    if (existing.ok) {
      return Response.json(
        {
          ok: false,
          message: "An author with this name already exists. Please check the Authors list."
        },
        {
          status: 409,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    if (existing.status !== 404) {
      throw new Error(
        "GitHub could not check whether this author already exists."
      );
    }

    // Publish the author profile to GitHub.
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Publish author profile: ${name}`,
        content: btoa(unescape(encodeURIComponent(frontmatter))),
        branch: BRANCH
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || "GitHub could not publish the author profile."
      );
    }

    return Response.json(
      {
        ok: true,
        name,
        path,
        message: "Author profile published to GitHub. The website will update after the deployment finishes."
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Author creation failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to publish this author profile."
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
