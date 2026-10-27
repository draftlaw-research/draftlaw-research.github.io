import { getCollection, getEntry } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { getCover } from './images';
import mostRead from '../data/most-read.json';

export type Topic = CollectionEntry<'topics'>;
export type Author = CollectionEntry<'authors'>;
export type TeamMember = CollectionEntry<'team'>;
export type StudentCollaborator = CollectionEntry<'studentCollaborators'>;
export type Program = CollectionEntry<'programs'>;
export type Announcement = CollectionEntry<'announcements'>;
export type NewsItem = CollectionEntry<'newsletter'>;

export type Guide = {
  id: string;
  entry: CollectionEntry<'guides'>;
  data: CollectionEntry<'guides'>['data'];
  topic: Topic | undefined;
  authors: Author[];
  minutes: number;
  url: string;
  cover: ImageMetadata;
};

export type Article = {
  id: string;
  entry: CollectionEntry<'articles'>;
  data: CollectionEntry<'articles'>['data'];
  topic: Topic;
  authors: Author[];
  minutes: number;
  url: string;
  cover: ImageMetadata;
};

/* ---------- Finding authors and topics ----------
   The CMS may save "mira-lindqvist", "mira-lindqvist.md", "src/content/authors/mira-lindqvist.md"
   or the full name. All of these are accepted. */

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const keyOf = (value: string) => value.trim().split('/').pop()!.replace(/\.(md|mdx)$/i, '');

function lookup<T extends { id: string; data: { name: string } }>(list: T[], value: string): T | undefined {
  const key = keyOf(value);
  return list.find((e) => e.id === key) ?? list.find((e) => slug(e.data.name) === slug(key));
}

/** All articles, newest first, with topic and authors already looked up. */
export async function getArticles(): Promise<Article[]> {
  const [entries, topics, authors] = await Promise.all([
    getCollection('articles'),
    getCollection('topics'),
    getCollection('authors'),
  ]);

  const articles = entries.map((entry): Article => {
    const topic = lookup(topics, entry.data.topic);
    if (!topic) {
      throw new Error(
        `Article "${entry.id}": topic "${entry.data.topic}" does not exist. Topics: ${topics.map((t) => t.id).join(', ')}`,
      );
    }
    const found = entry.data.authors.map((value) => {
      const author = lookup(authors, value);
      if (!author) {
        throw new Error(
          `Article "${entry.id}": author "${value}" does not exist. Authors: ${authors.map((a) => a.id).join(', ')}`,
        );
      }
      return author;
    });
    const words = (entry.body ?? '').split(/\s+/).filter(Boolean).length;
    return {
      id: entry.id,
      entry,
      data: entry.data,
      topic,
      authors: found,
      minutes: Math.max(1, Math.round(words / 220)),
      url: `/articles/${entry.id}/`,
      cover: getCover(entry.data.cover),
    };
  });
  return articles.sort((a, b) => +b.data.date - +a.data.date);
}


export async function getGuides(): Promise<Guide[]> {
  const [entries, topics, authors] = await Promise.all([
    getCollection('guides'),
    getCollection('topics'),
    getCollection('authors'),
  ]);

  const guides = entries.map((entry): Guide => {
    // A guide's topic is optional.
    const topic = entry.data.topic
      ? lookup(topics, entry.data.topic)
      : undefined;

    // Validate a topic only when one was supplied.
    if (entry.data.topic && !topic) {
      throw new Error(
        `Guide "${entry.id}" references missing topic "${entry.data.topic}".`,
      );
    }

    const found = entry.data.authors.map((value) => {
      const author = lookup(authors, value);

      if (!author) {
        throw new Error(
          `Guide "${entry.id}" references missing author "${value}".`,
        );
      }

      return author;
    });

    const words = (entry.body ?? '').split(/\s+/).filter(Boolean).length;

    return {
      id: entry.id,
      entry,
      data: entry.data,
      topic,
      authors: found,
      minutes: Math.max(1, Math.round(words / 220)),
      url: `/guidance/${entry.id}/`,
      cover: getCover(entry.data.cover),
    };
  });

    return guides.sort((a, b) => {
    const getPartNumber = (guide: Guide): number => {
      const match = guide.data.title.match(/\bPart\s+(\d+)\b/i);
      return match ? Number(match[1]) : Infinity;
    };

    return getPartNumber(a) - getPartNumber(b);
  });
}

export async function getTopics(): Promise<Topic[]> {
  const topics = await getCollection('topics');
  return topics.sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || a.data.name.localeCompare(b.data.name));
}

export async function getAuthors(): Promise<Author[]> {
  const authors = await getCollection('authors');
  return authors.sort((a, b) => a.data.name.localeCompare(b.data.name));
}

export async function getTeam(): Promise<TeamMember[]> {
  const team = await getCollection('team');
  return team.sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || a.data.name.localeCompare(b.data.name));
}
export async function getStudentCollaborators(): Promise<StudentCollaborator[]> {
  const students = await getCollection('studentCollaborators');
  return students.sort(
    (a, b) =>
      (a.data.order ?? 99) - (b.data.order ?? 99) ||
      a.data.name.localeCompare(b.data.name),
  );
}
export async function getPrograms(): Promise<Program[]> {
  const programs = await getCollection('programs');
  return programs.sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || a.data.title.localeCompare(b.data.title));
}

export async function getAnnouncements(): Promise<Announcement[]> {
  const items = await getCollection('announcements');
  return items.sort((a, b) => +b.data.date - +a.data.date);
}

export async function getPage(id: string) {
  const page = await getEntry('pages', id);
  if (!page) throw new Error(`Page "${id}" is missing in src/content/pages/.`);
  return page;
}

/* ---------- Dates ---------- */

/** Today at 00:00 UTC. The site is rebuilt every night, so "closed" stays up to date. */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function formatDate(date: Date, style: 'long' | 'short' = 'long'): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* ---------- Newsletter ---------- */

export type NewsState = NewsItem & { closed: boolean };

/** Newsletter items split into open (soonest deadline first) and closed (most recent first). */
export async function getNewsletter(): Promise<{ open: NewsState[]; closed: NewsState[] }> {
  const items = await getCollection('newsletter');
  const now = +today();
  const states: NewsState[] = items.map((e) => {
    const last = e.data.deadline ?? e.data.eventDate;
    return { ...e, closed: last ? +last < now : false };
  });
  const open = states
    .filter((i) => !i.closed)
    .sort((a, b) => {
      const da = a.data.deadline ? +a.data.deadline : Infinity;
      const db = b.data.deadline ? +b.data.deadline : Infinity;
      return da - db || +b.data.posted - +a.data.posted;
    });
  const closed = states
    .filter((i) => i.closed)
    .sort((a, b) => +(b.data.deadline ?? b.data.eventDate ?? 0) - +(a.data.deadline ?? a.data.eventDate ?? 0));
  return { open, closed };
}

/** The newest "Open call" announcement that has not passed its deadline. */
export function getOpenCall(announcements: Announcement[]): Announcement | undefined {
  const now = +today();
  return announcements.find((a) => a.data.type === 'Open call' && (!a.data.deadline || +a.data.deadline >= now));
}

/* ---------- Most read ---------- */

/** Most read list: the order comes from src/data/most-read.json. */
export function getMostRead(articles: Article[], count = 5): Article[] {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const picked = mostRead.slugs.map((s) => byId.get(s)).filter((a): a is Article => Boolean(a));
  return picked.slice(0, count);
}

/* ---------- Small helpers ---------- */

export const topicUrl = (t: Topic) => `/topics/${t.id}/`;
export const authorUrl = (a: Author) => `/authors/${a.id}/`;
export const teamUrl = (m: TeamMember) => `/team/${m.id}/`;
export const programUrl = (p: Program) => `/programs/${p.id}/`;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** OSCOLA-style citation for an online article. */
export function citation(article: Article, siteName: string, origin: string): string {
  const names = article.authors.map((a) => a.data.name);
  const who = names.length > 3 ? `${names[0]} and others` : nameList(names);
  return `${who}, '${article.data.title}' (${siteName}, ${formatDate(article.data.date)}) <${origin}${article.url}>`;
}
