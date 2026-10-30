
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";

const COLLECTIONS = {
  articles: "Articles",
  guides: "Guidelines and Guidance",
  authors: "Authors",
  topics: "Topics",
  team: "Team Members",
  "student-collaborators": "Student Collaborators",
  newsletter: "Newsletter",
  programs: "Programs",
  announcements: "Announcements"
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

function getCookie(request, name) {
  const cookies = (request.headers.get("Cookie") || "").split(";");

  const item = cookies
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`));

  return item ? item.substring(name.length + 1) : null;
}

function readField(content, field) {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatter) return null;

  const expression = new RegExp(
    `^${field}:\\s*(.*?)\\s*$`,
    "m"
  );

  const match = frontmatter[1].match(expression);

  if (!match) return null;

  let value = match[1].trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

function parseRecord(content, path, collection) {
  const filename = path.split("/").pop();
  const slug = filename.replace(/\.md$/i, "");

  const title =
    readField(content, "title") ||
    readField(content, "name") ||
    slug.replace(/[-_]/g, " ");

  return {
    collection,
    collectionLabel: COLLECTIONS[collection],
    slug,
    path,
    title,
    date: readField(content, "date"),
    kind: readField(content, "kind") ||
          readField(content, "type") ||
          readField(content, "category"),
    status: readField(content, "status"),
    featured: readField(content, "featured")
  };
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DraftLaw-Editorial-Portal"
  };
}

async function fetchRawFile(path, token) {
  const encodedPath = path
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");

  const url =
    `https://raw.githubusercontent.com/${REPOSITORY}/` +
    `${BRANCH}/${encodedPath}`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Could not read repository file: ${path}`);
  }

  return response.text();
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: "Required server settings are missing." },
        { status: 500 }
      );
    }

    const token = getCookie(request, "editorial_session");

    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json(
        { ok: false, message: "Please log in first." },
        { status: 401 }
      );
    }

    const tokenHash = await sha256(token);

    const session = await env.EDITORIAL_DB
      .prepare(`
        SELECT
          sessions.expires_at,
          users.role,
          users.is_active
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
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return Response.json(
        { ok: false, message: "Your login session has expired." },
        { status: 401 }
      );
    }

    if (session.role !== "admin") {
      return Response.json(
        { ok: false, message: "Administrator access required." },
        { status: 403 }
      );
    }

    const treeResponse = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/git/trees/${BRANCH}?recursive=1`,
      {
        headers: githubHeaders(env.GITHUB_TOKEN)
      }
    );

    if (!treeResponse.ok) {
      console.error("GitHub tree request failed:", treeResponse.status);

      return Response.json(
        { ok: false, message: "Could not retrieve the website content." },
        { status: 502 }
      );
    }

    const treeData = await treeResponse.json();

    if (treeData.truncated) {
      return Response.json(
        {
          ok: false,
          message: "The repository file list was incomplete."
        },
        { status: 502 }
      );
    }

    const files = treeData.tree.filter(item =>
      item.type === "blob" &&
      item.path.endsWith(".md") &&
      Object.keys(COLLECTIONS).some(collection =>
        item.path.startsWith(`src/content/${collection}/`)
      )
    );

    const records = [];

    // Read a small number of files at a time.
    for (let i = 0; i < files.length; i += 8) {
      const batch = files.slice(i, i + 8);

      const results = await Promise.all(
        batch.map(async file => {
          const content = await fetchRawFile(
            file.path,
            env.GITHUB_TOKEN
          );

          const collection = file.path.split("/")[2];

          return parseRecord(content, file.path, collection);
        })
      );

      records.push(...results);
    }

    records.sort((a, b) =>
      a.collectionLabel.localeCompare(b.collectionLabel) ||
      a.title.localeCompare(b.title)
    );

    const specialPaths = [
      "src/content/pages/submit.md",
      "src/content/pages/guidelines.md",
      "src/data/most-read.json"
    ];

    const specialFiles = {};

    for (const path of specialPaths) {
      const exists = treeData.tree.some(
        item => item.type === "blob" && item.path === path
      );

      if (exists) {
        const content = await fetchRawFile(
          path,
          env.GITHUB_TOKEN
        );

        if (path.endsWith(".json")) {
          specialFiles[path] = JSON.parse(content);
        } else {
          specialFiles[path] = parseRecord(
            content,
            path,
            "pages"
          );
        }
      }
    }

    return Response.json(
      {
        ok: true,
        branch: BRANCH,
        total: records.length,
        collections: COLLECTIONS,
        records,
        specialFiles
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Content listing failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load website content."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
