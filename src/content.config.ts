import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Forms (Pages CMS) save an empty box as '' . Treat that as "not filled in".
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const optDate = z.preprocess(blank, z.coerce.date().optional());
const optUrl = z.preprocess(blank, z.string().url().optional());
const optText = z.preprocess(blank, z.string().optional());
const optNumber = z.preprocess(blank, z.number().optional());
// One value or a list of values (a single choice in the CMS is saved as one value).
const many = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string()));

// A topic is a section of the site, for example "Human Rights".
const topics = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/topics' }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    order: optNumber,
  }),
});

// One file per contributor. The text under the top lines is the bio.
const authors = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: optText,
    affiliation: optText,
    country: optText,
    photo: optText, // /src/assets/authors/name.jpg
    orcid: optText,
    linkedin: optUrl,
    website: optUrl,
  }),
});

// One file per article. "authors" and "topic" hold the file name of the author / topic.
const articles = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(400), // shown on cards and in search results
    authors: many.pipe(z.array(z.string()).min(1)),
    topic: z.string(),
    kind: z.enum(['Article', 'Case summary', 'Commentary', 'Opinion', 'Book review']).default('Article'),
    date: z.coerce.date(),
    cover: optText, // /src/assets/covers/my-image.jpg
    coverAlt: z.preprocess(blank, z.string().default('')),
    coverCredit: optText, // shown under the image, e.g. Photo: Name / Unsplash
    featured: z.boolean().default(false), // pinned in the Featured block on the front page
    keywords: many,
    peerReviewed: z.boolean().default(true),
  }),
});

// Team members, shown on the About page. Same idea as authors.
const team = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/team' }),
  schema: z.object({
    name: z.string(),
    position: z.string(), // role inside DraftLaw Research, e.g. Founder and Director
    occupation: optText, // professional capacity, e.g. Doctoral researcher
    affiliation: optText, // university or organisation
    photo: optText, // /src/assets/team/name.jpg
    order: optNumber, // smaller numbers come first
    linkedin: optUrl,
    website: optUrl,
  }),
});

// A programme DraftLaw Research runs. The text below the top lines is the full description.
const programs = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/programs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(400),
    status: z.enum(['Open for applications', 'Upcoming', 'Ongoing', 'Closed']).default('Ongoing'),
    order: optNumber,
  }),
});

// Announcements inside Programs: open calls, updates, results.
const announcements = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/announcements' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    type: z.enum(['Open call', 'Update', 'Result']).default('Update'),
    program: optText, // file name of the programme it belongs to (optional)
    deadline: optDate, // for open calls
    link: optUrl, // where to apply or read more (optional)
  }),
});

// Newsletter items: calls for papers, seminars, moot courts and other opportunities.
const newsletter = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/newsletter' }),
  schema: z.object({
    title: z.string(),
    category: z
      .enum(['Call for papers', 'Seminar or conference', 'Moot court', 'Fellowship or internship', 'Other'])
      .default('Other'),
    organiser: optText,
    deadline: optDate, // last day to apply or submit
    eventDate: optDate, // date of the event, if it is an event
    location: optText,
    link: z.string().url(), // the actual call
    summary: z.string().max(500), // short description
    posted: z.coerce.date(),
  }),
});

// Stand-alone pages whose text editors can change, e.g. the submission rules.
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { topics, authors, articles, team, programs, announcements, newsletter, pages };
