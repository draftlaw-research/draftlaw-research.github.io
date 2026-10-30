
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";
const API = `https://api.github.com/repos/${REPOSITORY}`;

const COLLECTIONS = {
  articles: "Articles",
  guides: "Guides",
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

function getCookie(request) {
  const cookies = (request.headers.get("Cookie") || "").split(";");

  const item = cookies
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("editorial_session="));

  return item ? item.substring("editorial_session=".length) : null;
}

function headers(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DraftLaw-Editorial-Portal"
  };
}

async function githubGet(url, token) {
  const response = await fetch(url, {
    headers: headers(token)
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status}`);
  }

  return response.json();
}

function decodeBlob(base64) {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

async function readBlob(sha, token) {
  const blob = await githubGet(
    `${API}/git/blobs/${sha}`,
    token
  );

  if (blob.encoding !== "base64") {
    throw new Error("Unexpected GitHub file encoding.");
  }

  return decodeBlob(blob.content);
}

function readField(content, field) {
  const frontmatter = content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/
  );

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
    collectionLabel: COLLECTIONS[collection] || "Pages",
    slug,
    path,
    title,
    date: readField(content, "date"),
    kind:
      readField(content, "kind") ||
      readField(content, "type") ||
      readField(content, "category"),
    status: readField(content, "status"),
    featured: readField(content, "featured")
  };
}

async function checkAdmin(request, env) {
  const token = getCookie(request);

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
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

  return Boolean(
    session &&
    Number(session.is_active) === 1 &&
    new Date(session.expires_at).getTime() > Date.now() &&
    session.role === "admin"
  );
}

export async function onRequestGet({ request, env }) {
  let stage = "initialisation";

  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: "Required server settings are missing." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    stage = "admin authentication";

    if (!(await checkAdmin(request, env))) {
      return Response.json(
        { ok: false, message: "Administrator login required." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    stage = "reading branch information";

    const branch = await githubGet(
      `${API}/branches/${BRANCH}`,
      env.GITHUB_TOKEN
    );

    const commitSha = branch.commit.sha;

    stage = "reading commit information";

    const commit = await githubGet(
      `${API}/git/commits/${commitSha}`,
      env.GITHUB_TOKEN
    );

    const treeSha = commit.tree.sha;

    stage = "reading repository file list";

    const treeData = await githubGet(
      `${API}/git/trees/${treeSha}?recursive=1`,
      env.GITHUB_TOKEN
    );

    if (treeData.truncated) {
      throw new Error("Repository file list was incomplete.");
    }

    const files = treeData.tree.filter(item =>
      item.type === "blob" &&
      item.path.endsWith(".md") &&
      Object.keys(COLLECTIONS).some(collection =>
        item.path.startsWith(`src/content/${collection}/`)
      )
    );

    const records = [];

    stage = "reading content files";

    for (let i = 0; i < files.length; i += 5) {
      const batch = files.slice(i, i + 5);

      const results = await Promise.all(
        batch.map(async file => {
          const content = await readBlob(
            file.sha,
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

    stage = "reading special website files";

    const specialPaths = [
      "src/content/pages/submit.md",
      "src/data/most-read.json"
    ];

    const specialFiles = {};

    for (const path of specialPaths) {
      const file = treeData.tree.find(
        item => item.type === "blob" && item.path === path
      );

      if (file) {
        const content = await readBlob(
          file.sha,
          env.GITHUB_TOKEN
        );

        specialFiles[path] = path.endsWith(".json")
          ? JSON.parse(content)
          : parseRecord(content, path, "pages");
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
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    console.error("Content listing failed at:", stage, error);

   return Response.json(
  {
    ok: false,
    message: "Unable to load website content.",
    stage,
    error: error.message
  },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
