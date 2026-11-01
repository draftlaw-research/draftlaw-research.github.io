
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";
const API = `https://api.github.com/repos/${REPOSITORY}`;

const COLLECTIONS = {
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

async function githubRequest(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}): ${
        data.message || "Unknown error"
      }`
    );
  }

  return data;
}

async function getRepositoryTree(token) {
  const commit = await githubRequest(
    `${API}/commits/${encodeURIComponent(BRANCH)}`,
    token
  );

  const treeSha = commit.commit?.tree?.sha;

  if (!treeSha) {
    throw new Error("Could not identify the repository tree.");
  }

  const tree = await githubRequest(
    `${API}/git/trees/${treeSha}?recursive=1`,
    token
  );

  if (tree.truncated) {
    throw new Error(
      "GitHub returned an incomplete repository file list."
    );
  }

  return tree.tree || [];
}

async function getFileContents(paths, token) {
  const files = new Map();
  const batchSize = 20;

  for (let start = 0; start < paths.length; start += batchSize) {
    const batch = paths.slice(start, start + batchSize);

    const fields = batch.map((path, index) => {
      const expression = `${BRANCH}:${path}`;

      return `
        f${index}: object(expression: ${JSON.stringify(expression)}) {
          ... on Blob {
            text
          }
        }
      `;
    }).join("\n");

    const query = `
      query {
        repository(
          owner: "draftlaw-research",
          name: "draftlaw-research.github.io"
        ) {
          ${fields}
        }
      }
    `;

    const response = await fetch(
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers: {
          ...githubHeaders(token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      }
    );

    const result = await response.json();

    if (!response.ok || result.errors?.length) {
      const message = result.errors?.[0]?.message;

      throw new Error(
        `GitHub file retrieval failed: ${
          message || response.status
        }`
      );
    }

    const repository = result.data?.repository;

    if (!repository) {
      throw new Error(
        "GitHub did not return the requested repository."
      );
    }

    batch.forEach((path, index) => {
      const content = repository[`f${index}`]?.text;

      if (typeof content === "string") {
        files.set(path, content);
      }
    });
  }

  return files;
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

    stage = "reading repository file list";

    const tree = await getRepositoryTree(env.GITHUB_TOKEN);

    const relevantPaths = tree
      .filter(item => item.type === "blob")
      .map(item => item.path)
      .filter(path => {
        const isCollectionFile = Object.keys(COLLECTIONS).some(
          collection =>
            path.startsWith(`src/content/${collection}/`) &&
            path.endsWith(".md")
        );

        const isSubmitPage =
          path === "src/content/pages/submit.md";

        const isMostRead =
          path === "src/data/most-read.json";

        return isCollectionFile || isSubmitPage || isMostRead;
      });

    stage = "retrieving selected GitHub files";

    const files = await getFileContents(
      relevantPaths,
      env.GITHUB_TOKEN
    );

    stage = "reading content records";

    const records = [];

    for (const [path, content] of files) {
      const collection = Object.keys(COLLECTIONS).find(
        name => path.startsWith(`src/content/${name}/`)
      );

      if (!collection) continue;

      records.push(parseRecord(content, path, collection));
    }

    records.sort((a, b) =>
      a.collectionLabel.localeCompare(b.collectionLabel) ||
      String(a.title).localeCompare(String(b.title))
    );

    stage = "reading special website files";

    const specialFiles = {};

    const submitContent = files.get(
      "src/content/pages/submit.md"
    );

    if (submitContent) {
      specialFiles["src/content/pages/submit.md"] =
        parseRecord(
          submitContent,
          "src/content/pages/submit.md",
          "pages"
        );
    }

    const mostReadContent = files.get(
      "src/data/most-read.json"
    );

    if (mostReadContent) {
      specialFiles["src/data/most-read.json"] =
        JSON.parse(mostReadContent);
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
