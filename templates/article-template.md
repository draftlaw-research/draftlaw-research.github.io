---
# HOW TO USE: you normally use Pages CMS (see PUBLISHING.md). To do it by hand, copy this file into
# src/content/articles/, rename it (lowercase, words joined by dashes, for example "my-first-article.md"),
# then change the lines below. The file name becomes the web address.
# If a value contains a colon, put it in double quotes.

title: Your article title
summary: One or two sentences that tell a reader why to read this. It appears on cards and in Google.
authors: [author-file-name]        # file name of each author in src/content/authors, without .md
topic: constitutional-law          # one topic file name from src/content/topics, without .md
kind: Article                      # Article, Case summary, Commentary, Opinion or Book review
date: 2026-01-31                   # year-month-day
cover: /src/assets/covers/your-image.jpg   # upload the image into src/assets/covers first
coverAlt: Short description of the image for readers who cannot see it
featured: false                    # true pins it to the Featured block on the front page
keywords: [keyword one, keyword two]
peerReviewed: true
---

Write the article below this line. Use a blank line between paragraphs.

## A heading

Use two hash marks for a heading. Use *single stars* for italics (for case names) and **double stars** for bold.

> Start a line with this sign to make a quotation.

We do not use footnotes. Cite a source by linking the words: [the judgment](https://example.org/judgment).

A photo inside the text: ![Short description of the photo](/src/assets/images/your-photo.jpg)
