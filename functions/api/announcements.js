
const REPOSITORY = 'draftlaw-research/draftlaw-research.github.io';
const BRANCH = 'editorial-portal-development';
const CONTENT_PATH = 'src/content/announcements';
const PROGRAMS_PATH = 'src/content/programs';

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getCookie(request) {
  const cookies = (request.headers.get('Cookie') || '').split(';');

  const item = cookies
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('editorial_session='));

  return item ? item.substring('editorial_session='.length) : null;
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
        users.username,
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
    !['admin', 'editor'].includes(session.role)
  ) {
    return null;
  }

  return session;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function yamlString(value) {
  return JSON.stringify(value);
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
}

function isValidDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

async function githubRequest(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {})
    }
  });
}

async function getPrograms(token) {
  const url =
    `https://api.github.com/repos/${REPOSITORY}/contents/` +
    `${PROGRAMS_PATH}?ref=${BRANCH}`;

  const response = await githubRequest(url, token);

  if (!response.ok) {
    throw new Error('Could not load the existing Programs list from GitHub.');
  }

  const files = await response.json();

  if (!Array.isArray(files)) {
    throw new Error('The Programs folder could not be read.');
  }

  const programs = [];

  for (const file of files) {
    if (file.type !== 'file' || !file.name.endsWith('.md')) continue;

    const fileResponse = await githubRequest(file.url, token);

    if (!fileResponse.ok) continue;

    const fileData = await fileResponse.json();
    const markdown = decodeBase64(fileData.content || '');
    const titleMatch = markdown.match(/^title:\s*(.+)$/m);

    if (!titleMatch) continue;

    let title = titleMatch[1].trim();

    try {
      title = JSON.parse(title);
    } catch {
      title = title.replace(/^['"]|['"]$/g, '');
    }

    programs.push({
      title,
      path: `${PROGRAMS_PATH}/${file.name}`
    });
  }

  return programs.sort((a, b) => a.title.localeCompare(b.title));
}

function validateAnnouncement(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid announcement information.');
  }

  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const date = data.date;
  const type = data.type || 'Update';
  const program = data.program || '';
  const deadline = data.deadline || '';
  const link = data.link || '';

  if (!title || title.length > 250) {
    throw new Error('Enter a title of no more than 250 characters.');
  }

  if (!isValidDate(date)) {
    throw new Error('Enter a valid announcement date.');
  }

  if (!['Open call', 'Update', 'Result'].includes(type)) {
    throw new Error('Choose a valid announcement type.');
  }

  if (!body || body.length > 5000) {
    throw new Error('Enter announcement text of no more than 5,000 characters.');
  }

  if (deadline && !isValidDate(deadline)) {
    throw new Error('Enter a valid deadline date.');
  }

  if (
    typeof link !== 'string' ||
    link.length > 2000 ||
    (link && !/^https?:\/\/\S+$/i.test(link))
  ) {
    throw new Error('Enter a valid web link beginning with http:// or https://.');
  }

  if (
    typeof program !== 'string' ||
    (program &&
      (!program.startsWith(`${PROGRAMS_PATH}/`) ||
        !program.endsWith('.md') ||
        program.includes('..') ||
        program.includes('\\')))
  ) {
    throw new Error('Choose a valid program.');
  }

  return {
    title,
    date,
    type,
    program,
    deadline,
    link: link.trim(),
    body
  };
}

function buildMarkdown(item) {
  const frontmatter = [
    '---',
    `title: ${yamlString(item.title)}`,
    `date: ${item.date}`,
    `type: ${yamlString(item.type)}`,
    `program: ${yamlString(item.program)}`,
    `deadline: ${yamlString(item.deadline)}`,
    `link: ${yamlString(item.link)}`,
    '---',
    '',
    item.body,
    ''
  ];

  return frontmatter.join('\n');
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: 'Server configuration is incomplete.' },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        { ok: false, message: 'Please log in to continue.' },
        { status: 401 }
      );
    }

    const programs = await getPrograms(env.GITHUB_TOKEN);

    return Response.json(
      { ok: true, programs },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Announcement program list error:', error);

    return Response.json(
      {
        ok: false,
        message: error.message || 'Could not load the Programs list.'
      },
      { status: 500 }
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.EDITORIAL_DB || !env.GITHUB_TOKEN) {
      return Response.json(
        { ok: false, message: 'Server configuration is incomplete.' },
        { status: 500 }
      );
    }

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return Response.json(
        { ok: false, message: 'Please log in to continue.' },
        { status: 401 }
      );
    }

    const data = validateAnnouncement(await request.json());

    // If a program was selected, confirm that its Markdown file exists.
    if (data.program) {
      const programUrl =
        `https://api.github.com/repos/${REPOSITORY}/contents/` +
        `${data.program}?ref=${BRANCH}`;

      const programResponse = await githubRequest(
        programUrl,
        env.GITHUB_TOKEN
      );

      if (!programResponse.ok) {
        return Response.json(
          { ok: false, message: 'The selected program could not be found.' },
          { status: 400 }
        );
      }
    }

    const slug = slugify(data.title);

    if (!slug) {
      return Response.json(
        { ok: false, message: 'Please use a title containing letters or numbers.' },
        { status: 400 }
      );
    }

    const filePath = `${CONTENT_PATH}/${slug}.md`;
    const fileUrl =
      `https://api.github.com/repos/${REPOSITORY}/contents/${filePath}`;

    // Prevent an existing announcement from being overwritten.
    const existing = await githubRequest(
      `${fileUrl}?ref=${BRANCH}`,
      env.GITHUB_TOKEN
    );

    if (existing.ok) {
      return Response.json(
        {
          ok: false,
          message: 'An announcement with a similar title already exists. Please change the title.'
        },
        { status: 409 }
      );
    }

    if (existing.status !== 404) {
      throw new Error('Could not check whether this announcement already exists.');
    }

    const markdown = buildMarkdown(data);
    const encodedContent = btoa(
      String.fromCharCode(...new TextEncoder().encode(markdown))
    );

    const publishResponse = await githubRequest(
      fileUrl,
      env.GITHUB_TOKEN,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Publish program announcement: ${data.title}`,
          content: encodedContent,
          branch: BRANCH
        })
      }
    );

    const publishResult = await publishResponse.json();

    if (!publishResponse.ok) {
      console.error('GitHub announcement publishing error:', publishResult);

      return Response.json(
        {
          ok: false,
          message: 'GitHub could not publish the announcement. Please try again.'
        },
        { status: publishResponse.status }
      );
    }

    return Response.json(
      {
        ok: true,
        message: 'Announcement published successfully.',
        path: filePath
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Announcement publishing error:', error);

    return Response.json(
      {
        ok: false,
        message: error.message || 'The announcement could not be published.'
      },
      { status: 500 }
    );
  }
}
