
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "main";
const MAX_FILE_SIZE = 200 * 1024;
const GITHUB_TIMEOUT = 30000;

// --------------------------------------------------
// AUTHENTICATION UTILITIES
// --------------------------------------------------

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

// --------------------------------------------------
// AUTHOR PERMISSION CHECK
// --------------------------------------------------

async function checkAuthorsPermission(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return "unauthenticated";
  }

  const hash = await sha256(token);

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
  `).bind(hash).first();

  if (
    !session ||
    Number(session.is_active) !== 1 ||
    new Date(session.expires_at).getTime() <= Date.now() ||
    !["admin", "editor"].includes(session.role)
  ) {
    return "unauthenticated";
  }

  if (session.role === "admin") {
    return "allowed";
  }

  const permission = await env.EDITORIAL_DB.prepare(`
    SELECT 1
    FROM editor_section_permissions
    WHERE user_id = ?
      AND section_key = 'authors'
    LIMIT 1
  `).bind(session.user_id).first();

  return permission ? "allowed" : "forbidden";
}

// --------------------------------------------------
// IMAGE VALIDATION
// --------------------------------------------------

function imageExtension(bytes) {
  // JPEG
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }

  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // WebP
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

// --------------------------------------------------
// BASE64 CONVERSION
// --------------------------------------------------

function toBase64(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + 0x8000)
    );
  }

  return btoa(binary);
}

// --------------------------------------------------
// GITHUB RESPONSE HANDLING
// --------------------------------------------------

async function readGitHubResponse(response) {
  const text = await response.text();

  if (!text) {
    throw new Error(
      `GitHub returned an empty response (HTTP ${response.status}).`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `GitHub returned an invalid response (HTTP ${response.status}).`
    );
  }
}

// --------------------------------------------------
// AUTHOR PHOTO UPLOAD
// --------------------------------------------------

export async function onRequestPost({ request, env }) {
  let controller;
  let timeout;

  try {
    // Check configuration.
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json({
        ok: false,
        message: "Photo upload is not configured."
      }, {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Check user authentication.
    const access = await checkAuthorsPermission(request, env);

    if (access === "unauthenticated") {
      return Response.json({
        ok: false,
        message: "Please log in with an authorized account."
      }, {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (access === "forbidden") {
      return Response.json({
        ok: false,
        message: "You do not have permission to upload author photos."
      }, {
        status: 403,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Read uploaded photograph.
    const form = await request.formData();
    const file = form.get("photo");

    if (
      !file ||
      typeof file.arrayBuffer !== "function" ||
      file.size === 0
    ) {
      return Response.json({
        ok: false,
        message: "Choose a photograph first."
      }, {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Enforce the 200 KB limit on the server as well.
    if (file.size > MAX_FILE_SIZE) {
      return Response.json({
        ok: false,
        message:
          `The compressed photograph is ${Math.ceil(file.size / 1024)} KB. Maximum allowed size is 200 KB.`
      }, {
        status: 413,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Verify actual image file format.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes);

    if (!extension) {
      return Response.json({
        ok: false,
        message: "Use a valid JPEG, PNG or WebP photograph."
      }, {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }

    // Generate a unique filename.
    const filename = `author-${crypto.randomUUID()}.${extension}`;

    // Preserve the existing author image directory.
    const path = `src/assets/authors/${filename}`;

    const githubUrl =
      `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;

    // --------------------------------------------------
    // UPLOAD TO GITHUB WITH A TIMEOUT
    // --------------------------------------------------

    controller = new AbortController();

    timeout = setTimeout(() => {
      controller.abort();
    }, GITHUB_TIMEOUT);

    let response;

    try {
      response = await fetch(githubUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DraftLaw-Editorial-Portal",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Add author photo ${filename}`,
          content: toBase64(bytes),
          branch: BRANCH
        }),
        signal: controller.signal
      });

    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(
          "GitHub photo upload timed out. Please try again."
        );
      }

      throw new Error(
        "Could not connect to GitHub. Please check the server connection and try again."
      );

    } finally {
      clearTimeout(timeout);
      timeout = null;
    }

    // Validate GitHub response.
    const result = await readGitHubResponse(response);

    if (!response.ok) {
      console.error("GitHub author photo upload error:", {
        status: response.status,
        message: result.message
      });

      throw new Error(
        result.message ||
        `GitHub could not save the photograph (HTTP ${response.status}).`
      );
    }

    if (!result.content?.path) {
      throw new Error(
        "GitHub did not confirm that the photograph was saved."
      );
    }

    // Confirm successful upload.
    return Response.json({
      ok: true,
      photo: `/src/assets/authors/${filename}`,
      message: "Photo uploaded successfully."
    }, {
      status: 201,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    console.error("Author photo upload failed:", error);

    return Response.json({
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Unable to upload the photograph. Please try again."
    }, {
      status: 500,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
