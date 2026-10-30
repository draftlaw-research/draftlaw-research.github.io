
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";
const MAX_FILE_SIZE = 200 * 1024;

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

function detectImage(bytes) {
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

function toBase64(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "Image upload is not configured."
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

    const formData = await request.formData();
    const file = formData.get("cover");

    if (!file || typeof file.arrayBuffer !== "function") {
      return Response.json(
        {
          ok: false,
          message: "Choose a cover image first."
        },
        { status: 400 }
      );
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return Response.json(
        {
          ok: false,
          message: "The cover image must be between 1 byte and 200 KB."
        },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = detectImage(bytes);

    if (!extension) {
      return Response.json(
        {
          ok: false,
          message: "The file is not a valid JPEG, PNG or WebP image."
        },
        { status: 400 }
      );
    }

    const filename = `editorial-${crypto.randomUUID()}.${extension}`;

    // Store uploaded images in the public folder.
    const githubPath = `public/uploads/${filename}`;

    const githubResponse = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/contents/${githubPath}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DraftLaw-Editorial-Portal",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Add editorial cover image ${filename}`,
          content: toBase64(bytes),
          branch: BRANCH
        })
      }
    );

    if (!githubResponse.ok) {
      const errorText = await githubResponse.text();

      console.error(
        "GitHub cover image upload failed:",
        errorText
      );

      return Response.json(
        {
          ok: false,
          message: "GitHub could not store the cover image. Please try again."
        },
        { status: 502 }
      );
    }

    const githubResult = await githubResponse.json();
    const coverUrl = githubResult.content?.download_url;

    if (!coverUrl) {
      console.error(
        "GitHub did not return a cover image URL:",
        githubResult
      );

      throw new Error(
        "GitHub did not return the cover image URL."
      );
    }

    return Response.json(
      {
        ok: true,
        cover: coverUrl,
        message: "Cover image uploaded successfully."
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Cover upload failed:", error);

    return Response.json(
      {
        ok: false,
        message: error instanceof Error
          ? error.message
          : "Unable to upload the cover image."
      },
      { status: 500 }
    );
  }
}
