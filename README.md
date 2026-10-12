# DraftLaw Research website

Open legal scholarship platform. Built with [Astro](https://astro.build), hosted free on GitHub Pages.
Articles, authors, team, newsletter items and programs are plain text files, edited through
[Pages CMS](https://app.pagescms.org), so editors do not need to code.

Guides: **[PUBLISHING.md](PUBLISHING.md)** (editors) and **[CUSTOMIZING.md](CUSTOMIZING.md)** (fonts, spacing, colours, menu).

## Run it on your computer

You need **Node 22.12 or newer** (https://nodejs.org).

```bash
npm install        # once
npm run dev        # live preview at http://localhost:4321 (search needs a build, see below)
npm run build      # makes the final site in dist/ and the search index
npm run preview    # look at the built site, including search
```

## What is where

| Path | What it is |
|---|---|
| `src/content/articles/` | One `.md` file per article |
| `src/content/authors/` | One file per author (profile page) |
| `src/content/topics/` | One file per topic (a section of the site) |
| `src/content/team/` | One file per team member (About page) |
| `src/content/newsletter/` | One file per call, seminar or competition |
| `src/content/programs/` | One file per program |
| `src/content/announcements/` | Program announcements and open calls |
| `src/content/pages/submit.md` | The submission rules page |
| `src/assets/` | Pictures: `covers/`, `authors/`, `team/`, `images/`, `logo/` |
| `src/data/most-read.json` | The "Most read" list, updated by hand |
| `src/config.ts` | Site name, emails, menu, footer shortcuts, social links |
| `src/styles/global.css` | Fonts, sizes, line spacing and colours (settings at the top) |
| `src/pages/` | The page layouts |
| `.pages.yml` | The form layout in Pages CMS |
| `templates/` | Copy-and-fill templates for editing by hand |
| `_internal/` | **Not committed.** Demo, source documents and plans |

## Sections

Front page, Articles (filters), Topics, Authors, Newsletter, Programs (with Announcements), Write with us, About (with Team), Search.

## Search

Search runs in the visitor's browser using [Pagefind](https://pagefind.app). The index is created by `npm run build`, so on `npm run dev` the search page shows a short note. The live site and `npm run preview` have working search.

## Put it online (GitHub Pages)

1. Create a free GitHub organisation, for example `draftlaw-research`.
2. Create a **public** repository named exactly `draftlaw-research.github.io` (organisation name + `.github.io`).
   This name makes the site open at the root of the address. Any other name puts the site under `/repo-name/`, and the links will break until the custom domain is connected.
3. Push this project:
   ```bash
   git init -b main
   git add .
   git status        # check that _internal/, node_modules/ and dist/ are NOT listed
   git commit -m "First version"
   git remote add origin https://github.com/draftlaw-research/draftlaw-research.github.io.git
   git push -u origin main
   ```
4. On GitHub open **Settings > Pages** and set **Source** to **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes the site. It also runs **every night**, so newsletter items move to "Closed" after their deadline. Watch it in the **Actions** tab.
5. Buy the domain, then in **Settings > Pages > Custom domain** enter it and tick **Enforce HTTPS** once available.

## When the real domain is ready

Change it in three places: `astro.config.mjs` (`site`), `src/config.ts` (`url`) and `public/robots.txt`.

## Before launch checklist

- [ ] Delete the sample content: sample articles, authors, team members, newsletter items, announcement, and the placeholder covers (`columns`, `circuit`, `balance`, `meridians`, `arches`, `layers`). Keep `default.jpg`.
- [ ] Confirm the Program text (the mentor and student requirements are drafts) and remove the "DRAFT" note.
- [ ] Add the other social media addresses in `src/config.ts` (`SOCIALS`).
- [ ] Update `src/data/most-read.json` (an empty list hides the block).
- [ ] Decide the copyright wording in `src/config.ts` (`rights`).
- [ ] Add a short privacy note if you add analytics or an email newsletter sign-up.

## Notes

- Almost no JavaScript: only the filters, the search and the copy-citation button.
- Fonts (Georgia, with the free Gelasio as backup) are installed with the project, so visitors do not contact Google.
- Each article page carries scholarly metadata (`citation_*` tags and JSON-LD) so reference tools can read it.
- Pages print cleanly: menu and footer are hidden when printing.
- Built on Astro 7. Markdown is handled by Astro's built-in Sätteri processor; `src/plugins/asset-paths.mjs` lets editors insert images with the path Pages CMS writes.
