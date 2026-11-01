
const REPOSITORY = "draftlaw-research/draftlaw-research.github.io";
const BRANCH = "editorial-portal-development";
const API = `https://api.github.com/repos/${REPOSITORY}`;

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

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DraftLaw-Editorial-Portal"
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

  return value;
}

function getFrontmatter(content) {
  const match = content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/
  );

  if (!match) return {};

  const result = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^([A-Za-z0-9_-]+):\s*(.*)$/
    );

    if (!match) continue;

    const key = match[1];
    let value = match[2];

    if (
      (value.startsWith('"') && !value.endsWith('"')) ||
      (value.startsWith("'") && !value.endsWith("'"))
    ) {
      const quote = value[0];

      while (!value.endsWith(quote) && i + 1 < lines.length) {
        value += "\n" + lines[++i];
      }
    }

    result[key] = parseScalar(value);
  }

  return result;
}

async function getFileContents(paths, token) {
  const files = [];
  const batchSize = 20;

  for (let start = 0; start < paths.length; start += batchSize) {
    const batch = paths.slice(start, start + batchSize);

    const fields = batch.map((path, index) => `
      f${index}: object(
        expression: ${JSON.stringify(`${BRANCH}:${path}`)}
      ) {
        ... on Blob {
          text
        }
      }
    `).join("\n");

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
      throw new Error(
        result.errors?.[0]?.message ||
        `GitHub file retrieval failed (${response.status}).`
      );
    }

    const repository = result.data?.repository;

    if (!repository) {
      throw new Error("Could not retrieve repository content.");
    }

    batch.forEach((path, index) => {
      const content = repository[`f${index}`]?.text;

      if (typeof content === "string") {
        files.push({ path, content });
      }
    });
  }

  return files;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: "Server settings are missing." },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        { ok: false, message: "Please log in to continue." },
        { status: 401 }
      );
    }

    const commit = await githubRequest(
      `${API}/commits/${encodeURIComponent(BRANCH)}`,
      env.GITHUB_TOKEN
    );

    const treeSha = commit.commit?.tree?.sha;

    if (!treeSha) {
      throw new Error("Could not identify the repository files.");
    }

    const tree = await githubRequest(
      `${API}/git/trees/${treeSha}?recursive=1`,
      env.GITHUB_TOKEN
    );

    if (tree.truncated) {
      throw new Error("GitHub returned an incomplete file list.");
    }

    const paths = (tree.tree || [])
      .filter(item =>
        item.type === "blob" &&
        item.path.endsWith(".md") &&
        (
          item.path.startsWith("src/content/authors/") ||
          item.path.startsWith("src/content/topics/")
        )
      )
      .map(item => item.path);

    const files = await getFileContents(
      paths,
      env.GITHUB_TOKEN
    );

    const authors = [];
    const topics = [];

    for (const file of files) {
      const frontmatter = getFrontmatter(file.content);

      const filename = file.path.split("/").pop();

      const record = {
        path: file.path,
        name: String(
          frontmatter.name ||
          frontmatter.title ||
          filename.replace(/\.md$/i, "").replace(/[-_]/g, " ")
        )
      };

      if (file.path.startsWith("src/content/authors/")) {
        authors.push(record);
      } else if (file.path.startsWith("src/content/topics/")) {
        topics.push(record);
      }
    }

    authors.sort((a, b) => a.name.localeCompare(b.name));
    topics.sort((a, b) => a.name.localeCompare(b.name));

    return Response.json(
      {
        ok: true,
        authors,
        topics
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Submission options failed:", error);

    return Response.json(
      {
        ok: false,
        message: "Unable to load authors and topics."
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
