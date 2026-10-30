
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

  return item
    ? item.substring("editorial_session=".length)
    : null;
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DraftLaw-Editorial-Portal"
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

function readTarString(bytes, start, length) {
  return new TextDecoder().decode(
    bytes.subarray(start, start + length)
  ).replace(/\0.*$/, "");
}

function readTarOctal(bytes, start, length) {
  const value = readTarString(bytes, start, length).trim();

  return value ? parseInt(value, 8) : 0;
}

function extractTarFiles(bytes) {
  const files = new Map();
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);

    if (header.every(byte => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;

    const size = readTarOctal(header, 124, 12);
    const type = readTarString(header, 156, 1);

    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (
      (type === "" || type === "0") &&
      size >= 0 &&
      contentEnd <= bytes.length
    ) {
      const content = new TextDecoder().decode(
        bytes.subarray(contentStart, contentEnd)
      );

      files.set(path, content);
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

// Convert individual YAML values into JavaScript values.
function parseScalar(value) {
  value = value.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

// Read YAML frontmatter while preserving the Markdown body.
function parseFrontmatter(content) {
  const match = content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/
  );

  if (!match) return {};

  const lines = match[1].split(/\r?\n/);
  const result = {};

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const keyMatch = line.match(
      /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/
    );

    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    let value = keyMatch[2] || "";

    i++;

    // Read YAML lists, such as authors and keywords.
    if (value === "") {
      const items = [];

      while (
        i < lines.length &&
        /^\s+-\s*/.test(lines[i])
      ) {
        const item = lines[i].replace(/^\s+-\s*/, "");
        items.push(parseScalar(item));
        i++;
      }

      result[key] = items.length > 0 ? items : "";
      continue;
    }

    // Read quoted values that continue across multiple lines.
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];

      while (
        !value.endsWith(quote) &&
        i < lines.length
      ) {
        value += " " + lines[i].trim();
        i++;
      }

      result[key] = parseScalar(value);
      continue;
    }

    // Read ordinary indented multiline YAML values.
    const parts = [value];

    while (
      i < lines.length &&
      /^\s+\S/.test(lines[i]) &&
      !/^\s+-\s+/.test(lines[i])
    ) {
      parts.push(lines[i].trim());
      i++;
    }

    result[key] = parseScalar(parts.join(" "));
  }

  return result;
}

// Read a content record.
function parseRecord(content, path, collection) {
  const filename = path.split("/").pop();
  const slug = filename.replace(/\.md$/i, "");

  const frontmatter = parseFrontmatter(content);

  const bodyMatch = content.match(
    /^---\s*\r?\n[\s\S]*?\r?\n---\s*([\s\S]*)$/
  );

  const body = bodyMatch ? bodyMatch[1].trim() : content;

  const title =
    frontmatter.title ||
    frontmatter.name ||
    slug.replace(/[-_]/g, " ");

  return {
    collection,
    collectionLabel: COLLECTIONS[collection] || "Pages",
    slug,
    path,
    title,
    date: frontmatter.date ?? null,
    kind:
      frontmatter.kind ||
      frontmatter.type ||
      frontmatter.category ||
      null,
    status: frontmatter.status ?? null,
    featured: frontmatter.featured ?? null,
    summary: frontmatter.summary ?? null,
    authors: frontmatter.authors ?? [],
    topic: frontmatter.topic ?? null,
    cover: frontmatter.cover ?? null,
    coverAlt: frontmatter.coverAlt ?? null,
    coverCredit: frontmatter.coverCredit ?? null,
    keywords: frontmatter.keywords ?? [],
    peerReviewed: frontmatter.peerReviewed ?? null,
    frontmatter,
    body
  };
}

export async function onRequestGet({ request, env }) {
  let stage = "initialisation";

  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        {
          ok: false,
          message: "Required server settings are missing."
        },
        { status: 500 }
      );
    }

    stage = "admin authentication";

    if (!(await checkAdmin(request, env))) {
      return Response.json(
        {
          ok: false,
          message: "Administrator login required."
        },
        { status: 401 }
      );
    }

    stage = "downloading repository archive";

    const archiveResponse = await fetch(
      `${API}/tarball/${BRANCH}`,
      {
        headers: githubHeaders(env.GITHUB_TOKEN)
      }
    );

    if (!archiveResponse.ok) {
      throw new Error(
        `GitHub archive request failed: ${archiveResponse.status}`
      );
    }

    stage = "extracting repository archive";

    const decompressed = archiveResponse.body.pipeThrough(
      new DecompressionStream("gzip")
    );

    const tarBytes = new Uint8Array(
      await new Response(decompressed).arrayBuffer()
    );

    const archiveFiles = extractTarFiles(tarBytes);

    if (archiveFiles.size === 0) {
      throw new Error(
        "The repository archive contained no readable files."
      );
    }

    stage = "reading content files";

    const records = [];

    for (const [archivePath, content] of archiveFiles) {
      const path = archivePath
        .split("/")
        .slice(1)
        .join("/");

      if (!path.endsWith(".md")) continue;

      const collection = Object.keys(COLLECTIONS).find(
        name => path.startsWith(`src/content/${name}/`)
      );

      if (!collection) continue;

      records.push(
        parseRecord(content, path, collection)
      );
    }

    records.sort((a, b) =>
      a.collectionLabel.localeCompare(b.collectionLabel) ||
      String(a.title).localeCompare(String(b.title))
    );

    stage = "reading special website files";

    const specialFiles = {};

    const submitEntry = [...archiveFiles.entries()].find(
      ([path]) => path.endsWith("/src/content/pages/submit.md")
    );

    if (submitEntry) {
      specialFiles["src/content/pages/submit.md"] =
        parseRecord(
          submitEntry[1],
          "src/content/pages/submit.md",
          "pages"
        );
    }

    const mostReadEntry = [...archiveFiles.entries()].find(
      ([path]) => path.endsWith("/src/data/most-read.json")
    );

    if (mostReadEntry) {
      specialFiles["src/data/most-read.json"] =
        JSON.parse(mostReadEntry[1]);
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
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
