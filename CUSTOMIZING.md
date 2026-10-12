# Changing how the site looks

You do not need to know how to code. Almost everything is in **one place**: the first 60 lines of `src/styles/global.css`. Change a value, save, and look at the result with `npm run dev`.

## Fonts

```css
--font-body: Georgia, 'Gelasio Variable', 'Times New Roman', serif; /* all text */
--font-ui: Georgia, 'Gelasio Variable', 'Times New Roman', serif; /* menu, labels, buttons */
```

- **Georgia** is used when the visitor's device has it (Windows, Mac, iPhone, iPad).
- **Gelasio** is a free font designed to look like Georgia. It is used on devices without Georgia (Android, many Linux computers). It is installed with the site, so nothing is loaded from other companies.
- **Georgia Pro** is a Microsoft 365 font. It is licensed for Office documents, not for websites, so it cannot be used here. For documents, authors can keep using Georgia Pro in Word.

To use a different font, for example Merriweather:

1. Run `npm install @fontsource-variable/merriweather`.
2. In `src/layouts/Base.astro`, replace the two Gelasio lines with `import '@fontsource-variable/merriweather';`.
3. In `global.css`, set `--font-body: 'Merriweather Variable', Georgia, serif;`.

Browse free fonts at https://fontsource.org.

To use a **different font only for the menu and small labels**, change `--font-ui` alone. To use a clean sans-serif there: `--font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;`.

## Text size and line spacing

```css
--text-size: 1.0625rem;  /* normal text on pages (about 17px) */
--text-leading: 1.65;    /* line spacing of normal text */
--article-size: 1.16rem; /* text inside articles (about 18.5px) */
--article-leading: 1.75; /* line spacing inside articles */
--article-align: left;   /* change to justify for justified text */
--article-width: 42rem;  /* width of the reading column */
--paragraph-gap: 1.25em; /* space between paragraphs */
```

- **Line spacing:** a bigger number gives more space. 1.5 is airy, 1.8 is very airy.
- **Text size:** `1rem` is the normal browser size (usually 16px). `1.25rem` is 25% bigger.
- **Justified text:** set `--article-align: justify;`. On narrow phone screens justified text can show gaps between words, so many sites keep `left`.
- **Headings:** their sizes are set further down in `global.css`: search for `.article-head h1` (article title), `.hero h1` (front page title) and `.page-title h1` (page titles).

## Colours

```css
--paper: #000000;  /* page background */
--surface: #121212; /* cards and boxes */
--ink: #ece7dd;    /* main text */
--muted: #a8a196;  /* secondary text */
--accent: #b69d73; /* gold from the logo */
```

Keep `--paper` and `--header-bg` at pure black `#000000`: the logo picture has a pure black background and shows a visible box on any other shade.

## Menu, footer shortcuts and social media

All in `src/config.ts`:

- `NAV`: the main menu (rename or reorder).
- `EXPLORE`: shortcuts in the footer.
- `SOCIALS`: social accounts in the footer. Paste the address into the empty `url` and it appears. An empty one stays hidden.
- `SITE`: name, emails, copyright line.

## Logo

- `src/assets/logo/emblem.png`: the small mark in the header.
- `src/assets/logo/logo-full.png`: the full logo in the footer and on the front page.
- `public/`: browser icon (`favicon.ico`, `favicon-48.png`), phone icon (`apple-touch-icon.png`) and the picture shown when a link is shared (`og-default.jpg`).

Replace a file with a new one of the same name and keep the black background.

## A light version

The site is dark only. To make a light version, set `--header-bg` and `--paper` to a light colour (for example `#faf8f4`), `--surface` to `#ffffff`, `--ink` to `#1b1a18`, `--muted` to `#625e57`, `--rule` to `#e4dfd5`, `--accent` to a darker gold such as `#8a6d3b`, `--accent-ink` to `#ffffff`, and change `color-scheme: dark` to `light`. The logo pictures would then show a black box, so use a transparent version of the logo.
