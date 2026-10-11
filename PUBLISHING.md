# Publishing guide for editors

No coding needed. Everything is done in **Pages CMS**: https://app.pagescms.org (sign in with GitHub, choose this repository). Saving an entry updates the site in 1 to 2 minutes.

> **Never put drafts, reviews or student submissions in this repository.** It is public. Keep them in Google Docs or email until they are final and approved.

## What you can edit

| Menu in Pages CMS | What it controls on the site |
|---|---|
| Articles | The article pages, front page, topic pages, search |
| Authors | Author profile pages (name, photo, bio) |
| Topics | The topic sections |
| Team members | The "Our team" part of the About page and each member's profile |
| Newsletter items | The Newsletter page (calls for papers, seminars, moot courts) |
| Programs | The Programs pages (requirements, how to apply) |
| Program announcements | Announcements inside Programs, and the "Open call" banner on the front page |
| Write with us | The submission rules page |
| Most read list | The "Most read" box on the front page |

## Publish an article

1. **Authors** must already exist (see "Add an author" below).
2. Open **Articles**, then **Add an entry**.
3. Fill in the form:
   - **Authors** and **Topic**: pick from the list. New authors and topics appear here automatically, you never edit the configuration.
   - **Cover image**: click, upload (1200 x 630 pixels, JPG, under 200 KB) or choose an existing one.
   - **Image description**: one sentence for readers who cannot see the image.
   - **Pin to Featured**: tick to show it at the top of the front page (up to three show).
4. Write or paste the article in **Article text**.
5. Click **Save**.

### Sources: hyperlinks, not footnotes

We do not use footnotes or endnotes. Cite a source by linking the words that refer to it:

1. Select the words in the editor.
2. Click the **link button** (or press Ctrl+K, or Cmd+K on Mac).
3. Paste the address and confirm.

In the text file this looks like `[the judgment](https://example.org/judgment)`. Links to other websites show a small arrow on the site.

### Photos inside an article

1. Put the cursor where the photo should go.
2. Click the **image button** in the editor, upload a photo or choose one.
3. Write a short description of the photo when asked.

If you edit the text file by hand, write `![Short description](/src/assets/images/photo.jpg)` after uploading the picture into the folder `src/assets/images`. Both spellings of the path work.

Keep photos under 300 KB. The site makes smaller versions automatically.

## Add an author (and their photo)

1. Open **Authors**, then **Add an entry**.
2. Fill in name, role, university, country and a short bio.
3. **Photo**: click, upload a square picture (for example 600 x 600), and save.

The author now appears in the Authors list on every article form, and gets their own page.

If you edit by hand: upload the picture to `src/assets/authors`, then add `photo: /src/assets/authors/firstname-lastname.jpg` to the author file.

## Add a topic

Open **Topics**, **Add an entry**. Give it a name, a one-line description and an order number. Keep topics few and broad.

## Newsletter: add a call or event

1. Open **Newsletter items**, then **Add an entry**.
2. Choose the **Type** (Call for papers, Seminar or conference, Moot court, Fellowship or internship, Other).
3. Write a **short description** (2 or 3 sentences) and paste the **link to the original call**.
4. Set the **Deadline** (for calls) or the **Event date** (for events). Leave both empty if there is no date.
5. Save.

The item appears under **Open now**, sorted by nearest deadline. After the deadline passes it moves to **Closed** by itself (the site rebuilds every night).

## Programs and announcements

- **Programs**: edit the program text. Use "Heading 2" for main parts (About, For mentors, For students) and "Heading 3" for sub parts (What we look for, Responsibilities, Who can apply, How to apply). The small menu on the right is built from the Heading 2 lines.
- **Program announcements**: add an entry when you open a call. Choose **Open call**, set the **Deadline** and a link. It shows on the Programs page, on the Announcements page, and as a banner on the front page until the deadline passes.

## Team members

Open **Team members**, **Add an entry**. Fill in name, position in DraftLaw Research, occupation, affiliation, photo and a short bio. The **Order** number sets the order on the About page (1 comes first).

## Submission rules page

Open **Write with us**. Edit the text. Keep "Heading 2" for each main section, because the menu on the right is made from them.

## Update "Most read"

Once a month, check the visitor numbers, then open **Most read list** and enter the article file names (without `.md`), most read first. Four or five is enough.

## Remove something

Delete the entry in Pages CMS. GitHub keeps the history, so it can be restored.

## If you edit text files by hand

- If a value contains a colon or starts with a quote, put the whole value in double quotes: `title: "Case summary: Sample v State"`.
- A wrong author or topic name stops the site from updating. Open the **Actions** tab on GitHub to see the red cross and the exact reason.
- Dates are written year-month-day: `2026-10-31`.

## Without Pages CMS

Every entry is a text file in `src/content/<menu name>/`. Copy a file from `templates/`, change the lines at the top, and commit on GitHub.
