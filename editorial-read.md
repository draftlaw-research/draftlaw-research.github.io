# DraftLaw Research — Editorial Portal
## Consolidated Technical Specification

**Document status:** Working specification  
**Project:** DraftLaw Research Editorial Portal  
**Development target:** `editorial-portal-development` branch  
**Production branch:** `main`  
**Hosting:** Cloudflare Pages + Cloudflare Workers  
**Database:** Cloudflare D1 (SQLite)  
**Website framework:** Astro  
**Editorial application:** Separate authenticated portal

---

# 1. Project objective

Replace Pages CMS with a dedicated editorial management portal for DraftLaw Research.

The portal will allow administrators, moderators (future role) and multiple editors to manage website content without giving editors direct access to the website's GitHub repository or source code.

The portal must support:

- Multiple editors with configurable section permissions.
- Administrator-controlled content management.
- Submission and approval workflows.
- Edit and deletion requests.
- In-app notifications.
- Activity tracking and administrative audit history.
- Safe publishing to the public website through GitHub.
- Preservation of existing Markdown, JSON, frontmatter and asset conventions.

The replacement must preserve the existing website's content structure and functionality.

# 2. Technical architecture

## 2.1 Technology stack

| Component | Technology |
|---|---|
| Public website | Astro |
| Editorial interface | Existing portal frontend |
| Hosting | Cloudflare Pages |
| Backend | Cloudflare Workers / Pages Functions |
| Database | Cloudflare D1 (SQLite) |
| Authentication | Secure server-side sessions |
| Content editor | Tiptap |
| Website content repository | GitHub |
| Version control | GitHub |
| Production deployment | Cloudflare Pages |

## 2.2 Architecture and separation

The editorial portal and public website must remain logically separated.

**Editorial portal responsibilities:**
- User authentication.
- User roles and permissions.
- Content creation.
- Submission storage.
- Approval workflows.
- Notifications.
- Activity and audit records.
- GitHub publishing operations.

**Public website responsibilities:**
- Display published content.
- Generate article and guidance pages.
- Render authors, topics and other content.
- Generate the Pagefind search index.
- Serve website assets.

Editors must never receive GitHub credentials, repository write access or direct access to website source code.

Only authorized backend publishing operations may interact with GitHub.

# 3. GitHub branch policy

Two branches have distinct purposes.

| Branch | Purpose |
|---|---|
| `editorial-portal-development` | All development and testing |
| `main` | Production website |

Mandatory rules:

1. All portal development takes place on `editorial-portal-development`.
2. No development changes are made directly to `main`.
3. Approved editorial publishing changes are committed to the development branch.
4. Development builds must be tested.
5. Build failures must be investigated and resolved.
6. Production merging requires successful verification and explicit authorization.
7. No automatic merge to `main`.

The editorial publishing mechanism and software deployment mechanism must be treated as separate processes.

# 4. User roles and permissions

There are three planned roles.

## 4.1 Administrator

The administrator has complete authority over the portal.

Permissions:

- Create, edit and delete all content.
- View existing website articles and guidelines.
- Create and manage articles and guidelines.
- Review, accept and reject submissions.
- Add mandatory rejection comments.
- Approve or reject edit requests.
- Approve or reject deletion requests.
- Create, edit, disable and manage editor accounts.
- Assign one or multiple sections to editors.
- Manage moderator accounts in the future.
- View detailed activity and audit history.
- Override moderator decisions.
- Manage publishing and investigate failures.

The administrator is the highest authority.

Initially, there will be one administrator.

## 4.2 Moderator (future functionality)

Moderators may be introduced later.

Permissions:

- Review submissions.
- Accept or reject submissions.
- Review edit requests.
- Accept or reject edit requests.
- Participate in the approval process.

Restrictions:

- Cannot delete content.
- Cannot manage administrator accounts.
- Cannot override administrator decisions.
- Cannot override an administrator's final decision.

In case of conflicting decisions, the administrator's decision takes precedence.

Moderator functionality should be designed into the permission architecture without making it mandatory for the initial release.

## 4.3 Editor

Editors have configurable section permissions.

An administrator can assign one or multiple sections to each editor.

Editors can:

- Create new articles and guidelines in assigned sections.
- Create new entries in other assigned sections.
- Submit edit requests for existing persistent content.
- Submit deletion requests for existing persistent content.
- View submissions and activity from other editors within their assigned sections.
- View their notifications.
- View the status of their own requests.
- Revise rejected article and guideline submissions.
- Resubmit revised submissions.

Editors cannot:

- Approve or reject submissions.
- Directly edit published website content.
- Directly delete published website content.
- Modify activity records.
- Modify another editor's submission.
- Change their own section permissions.
- Access GitHub credentials or repository write operations.
- Override administrative decisions.

All activity records are read-only for editors.

# 5. Content management structure

The replacement must support all content types defined in the existing `.pages.yml`.

There are 11 content-management areas.

## 5.1 Articles

**Website path:** `src/content/articles/`

Fields:

| Field | Type | Requirement |
|---|---|---|
| Title | String | Required |
| Summary | Text | Required, maximum 400 characters |
| Authors | Multiple references | Required |
| Topic | Reference | Required |
| Kind | Select | Default: Article |
| Date | Date | Required |
| Cover | Image | Optional |
| Cover alt | String | Optional |
| Cover credit | String | Optional |
| Featured | Boolean | Default false |
| Keywords | List | Optional |
| Peer reviewed | Boolean | Default true |
| Body | Rich text | Required |

Allowed kinds:
- Article
- Case summary
- Commentary
- Opinion
- Book review

Author references must use the existing Authors collection.

Topic references must use the existing Topics collection.

## 5.2 Guidelines and Guidance

**Website path:** `src/content/guides/`

Fields:

- Title (required).
- Summary (required, maximum 400 characters).
- Multiple authors (required).
- Guidance type.
- Publication date (required).
- Cover image.
- Cover alternative text.
- Cover credit.
- Featured.
- Keywords.
- Blind peer review (default true).
- Rich-text body.

Allowed guidance types:

- Research Guide
- Writing Guide
- Moot Court Guide
- Academic Skills
- Other

Unlike Articles, Guidelines do not require a topic.

## 5.3 Authors

**Website path:** `src/content/authors/`

Fields:

- Full name (required).
- Role or occupation.
- Affiliation.
- Country.
- Photo.
- ORCID.
- LinkedIn.
- Facebook.
- Instagram.
- Website.
- Short biography.

## 5.4 Topics

**Website path:** `src/content/topics/`

Fields:

- Topic name (required).
- One-line description (required).
- Numerical display order.

## 5.5 Team members

**Website path:** `src/content/team/`

Fields:

- Full name (required).
- Position (required).
- Occupation.
- Affiliation.
- Photo.
- Display order.
- LinkedIn.
- Facebook.
- Instagram.
- Website.
- Short biography.

## 5.6 Student Collaborators

**Website path:** `src/content/student-collaborators/`

Fields:

- Full name (required).
- Position as Student Collaborator (required).
- Occupation or degree.
- Affiliation.
- Photo.
- Display order.
- LinkedIn.
- Facebook.
- Instagram.
- Website.
- Short biography.

This must remain a separate collection from Team members.

## 5.7 Newsletter items

**Website path:** `src/content/newsletter/`

Fields:

- Title (required).
- Category.
- Organiser.
- Deadline.
- Event date.
- Location.
- Original call URL (required).
- Summary (required, maximum 500 characters).
- Posting date (required).

Allowed categories:

- Call for papers
- Seminar or conference
- Moot court
- Fellowship or internship
- Other

## 5.8 Programs

**Website path:** `src/content/programs/`

Fields:

- Program name (required).
- Summary (required, maximum 400 characters).
- Status.
- Display order.
- Full rich-text description.

Allowed statuses:

- Open for applications
- Upcoming
- Ongoing
- Closed

## 5.9 Program announcements

**Website path:** `src/content/announcements/`

Fields:

- Title (required).
- Date (required).
- Type.
- Associated program (optional reference).
- Deadline.
- Application or information link.
- Announcement body.

Allowed types:

- Open call
- Update
- Result

## 5.10 Write with us

**Website path:** `src/content/pages/submit.md`

A single editable Markdown resource.

Fields:

- Page title.
- Short description.
- Rich-text submission guidelines.

## 5.11 Most read list

**Website path:** `src/data/most-read.json`

A JSON resource containing an ordered list of article slugs.

The portal must provide an interface to manage the list and its ordering.

---

# 6. Content storage architecture

This is one of the most important architectural distinctions.

There are two different storage models.

## 6.1 Temporary content: Articles and Guidelines

Existing published Articles and Guidelines must NOT be copied into D1.

They remain in GitHub:

- `src/content/articles/`
- `src/content/guides/`

The portal retrieves existing records from GitHub for display and reference.

Editors can see existing records but cannot directly modify or delete them.

New Articles and Guidelines are temporarily stored in D1.

After approval and successful GitHub publication:

1. The Markdown file is committed to the development branch.
2. The publishing operation is verified.
3. The approved submission payload is deleted from the temporary submission storage.
4. Its activity/audit record remains.

Rejected submissions remain available for revision and resubmission.

## 6.2 Persistent content: Other nine content areas

Authors, Topics, Team, Student Collaborators, Newsletter, Programs, Announcements, Write with us and Most read are managed through persistent portal storage.

Their records remain in D1.

Editors may create new entries or request modifications and deletions.

Administrators control whether those changes are accepted.

Unlike Articles and Guidelines, these records must not disappear from the portal after approval.

## 6.3 Important storage distinction

D1 is the persistent operational database for the portal.

GitHub is the publication repository for the public Astro website.

The exact synchronization process for persistent content must be finalized before implementation.

The intended result is that approved content changes appear on the public website while the portal retains its persistent content records.

---

# 7. Article and Guidelines approval workflow

These two content types have a dedicated lifecycle.

### Submission states

- Submitted
- Under review
- Rejected
- Resubmitted
- Approved
- Publishing
- Published
- Publication failed

### Workflow

1. Editor creates a new Article or Guideline.
2. Portal validates required fields.
3. Submission is saved in D1.
4. Administrator receives an in-app notification.
5. Administrator reviews the submission.
6. Administrator accepts or rejects it.
7. Rejection requires a comment explaining the reason.
8. Rejected submission is returned to the editor.
9. Editor makes corrections and resubmits.
10. Accepted submission proceeds to GitHub publication.
11. After successful commit, temporary submission content is removed.
12. The activity record is retained.

An editor must be able to see the rejection reason and the status of their submission.

The administrator must be able to see submissions from all editors.

# 8. Persistent content approval workflow

This workflow applies to the other nine content areas.

## 8.1 Creating new content

1. Editor creates a new record in an assigned section.
2. The record is stored in D1.
3. The editor submits it for review.
4. Administrator reviews the record.
5. Administrator accepts or rejects it.
6. Accepted content becomes part of the persistent content collection.
7. Rejected content is returned with an explanation.

## 8.2 Requesting edits

Editors cannot directly edit existing persistent content.

Instead:

1. Editor opens an existing record.
2. Editor submits a proposed change.
3. The proposal is saved separately in D1.
4. Administrator reviews the proposed changes.
5. Administrator accepts or rejects the request.
6. If accepted, the existing record is updated.
7. The original record and its change history are preserved for administrative review.

## 8.3 Requesting deletion

Editors cannot directly delete records.

Instead:

1. Editor requests deletion.
2. A deletion request is recorded in D1.
3. Administrator reviews the request.
4. Administrator approves or rejects it.
5. Only the administrator can authorize deletion.

Deletion must be auditable.

# 9. Notifications

Notifications are exclusively in-app.

No email notification functionality is required.

The dashboard must display relevant notifications for:

- New submissions.
- Submission acceptance.
- Submission rejection.
- Rejection comments.
- Resubmissions.
- Edit request decisions.
- Deletion request decisions.
- Publishing failures.
- Other relevant administrative actions.

Notifications must be linked to their corresponding submissions or requests.

# 10. Activity and audit system

Every significant action must be recorded.

Examples:

- Editor account creation.
- Permission assignment.
- New submission.
- Submission acceptance.
- Submission rejection.
- Resubmission.
- Edit request.
- Deletion request.
- Administrative decision.
- GitHub publishing operation.
- Publishing failure.

## Editor visibility

Editors can see activity records within their assigned sections.

They cannot:

- Edit activity.
- Delete activity.
- Change activity status.
- Add administrative decisions.

## Administrator visibility

Administrators can access detailed records, including:

- Actor ID.
- Actor role.
- Action.
- Content type.
- Content identifier.
- Timestamp.
- Previous values where applicable.
- New values where applicable.
- Decision comments.
- Approval identity.
- Relevant publishing results.

## Articles and Guidelines activity format

For these content types, the displayed activity record should follow the requested convention:

`editor_ID_created_submission_type_title_by_author-name_date-of-submission_accepted_date-of-acceptance`

No additional revision-history interface is required for Articles and Guidelines, including for administrators.

The activity record must survive deletion of the temporary submission payload.

# 11. Dashboard requirements

The existing dashboard is the starting point.

Reference preview:

https://e2fa95e6.draftlaw-research-github-io.pages.dev/editorial/dashboard/

The portal should include:

### Administrator dashboard

- Overview and activity summary.
- All content collections.
- Submission review queue.
- Edit request queue.
- Deletion request queue.
- Editor management.
- Section permission management.
- Moderator management (future).
- Notifications.
- Detailed activity history.
- GitHub publishing status.

### Editor dashboard

- Assigned sections.
- Create content shortcuts.
- My submissions.
- My edit requests.
- My deletion requests.
- Submission statuses.
- Notifications.
- Read-only activity feed.

The editor dashboard must not expose administrator-only controls.

# 12. Image and rich-text requirements

## Images

Existing Pages CMS configuration specifies:

- JPEG.
- JPG.
- PNG.
- WebP.

Cover images:

- Recommended dimensions: 1200 × 630.
- Maximum size: 200 KB.
- Cover assets: `src/assets/covers/`.

Other asset directories:

- `src/assets/authors/`
- `src/assets/team/`
- `src/assets/student-collaborators/`
- `src/assets/images/`

The portal must preserve the correct asset paths.

The 200 KB restriction is explicitly specified for cover images. Whether it also applies to other uploaded images must be confirmed.

## Rich-text editor

Use the existing Tiptap dependencies.

Required capabilities include:

- Headings.
- Paragraphs.
- Bold and italic.
- Underline.
- Lists.
- Numbered lists.
- Hyperlinks.
- Images.
- Tables.
- Text alignment.
- Appropriate inline formatting.

Content must remain compatible with the existing Astro Markdown rendering system.

Sources in articles should be linked using hyperlinks rather than footnotes or endnotes.

Unknown existing frontmatter fields must be preserved when editing existing website files.

# 13. Authentication and security

The portal must provide secure authentication.

Requirements:

- Hashed passwords.
- Secure server-side sessions.
- Secure cookies.
- Role-based authorization.
- Section-based permission checks.
- Server-side validation.
- CSRF protection where applicable.
- Rate limiting for authentication endpoints.
- Protection against unauthorized API access.
- GitHub credentials stored only as backend secrets.
- No sensitive credentials exposed to browser JavaScript.

Every sensitive operation must verify authorization on the backend, not merely hide buttons in the interface.

# 14. Database architecture

Cloudflare D1 will use SQLite.

The initial logical data model should include:

| Table | Purpose |
|---|---|
| users | Admin, moderator and editor accounts |
| sessions | Authenticated sessions |
| editor_section_permissions | Section assignments |
| content_records | Persistent content |
| submissions | Temporary Article and Guideline submissions |
| change_requests | Proposed edits |
| deletion_requests | Proposed deletions |
| submission_decisions | Approval and rejection decisions |
| notifications | In-app notifications |
| activity_logs | Activity and audit records |
| publishing_jobs | GitHub publication tracking |
| publishing_events | Commit and deployment events |

This is a proposed logical schema, not a finalized physical database migration.

Foreign keys, indexes, unique constraints, status transitions and transaction boundaries must be designed before implementation.

# 15. GitHub publishing integration

GitHub publishing must be performed through a secure backend integration.

The portal must:

1. Authenticate through a server-side GitHub credential.
2. Identify the correct development branch.
3. Retrieve the current repository version.
4. Generate the appropriate Markdown or JSON changes.
5. Preserve existing file structure and frontmatter.
6. Commit approved changes.
7. Record the commit SHA.
8. Record the publication result.
9. Handle concurrent repository changes safely.

Editors must never be able to execute arbitrary GitHub operations.

For persistent content, approved changes must also reach the public website while their portal records remain in D1.

# 16. Build and deployment safety

A successful build is a prerequisite for merging development into main.

The website currently uses:

`npm run build`

The supplied package configuration defines this as:

`astro build && pagefind --site dist`

The project requires Node.js 22.12 or newer.

Before production merge:

- Dependencies must install successfully.
- Astro build must succeed.
- Pagefind indexing must succeed.
- Content validation must succeed.
- GitHub publishing must be verified.
- No unintended changes to existing content may be present.

## Publishing failure handling

Approved content must never be silently lost.

If a GitHub commit succeeds but the Pages build fails:

- Keep the GitHub commit.
- Preserve the approved content in GitHub.
- Record the failed deployment.
- Notify the administrator.
- Keep the previous successful live deployment available.
- Allow an authorized administrator/developer to fix the website code and rebuild.

A failed build cannot itself be deployed to the live website. The portal must not report a failed deployment as successful publication.

The publishing and deployment statuses must be tracked separately.

# 17. Existing branch baseline

The supplied development-branch ZIP contains:

- Astro 7.
- Node.js engine requirement of at least 22.12.
- Tiptap dependencies.
- Markdown conversion dependencies.
- Existing website content collections.
- Cloudflare-style API route structure under `functions/api/`.
- Authentication endpoints.
- Submission creation endpoint.
- Submission option retrieval.
- Cover and inline-image upload endpoints.
- Administrative content retrieval endpoint.
- GitHub connectivity test endpoint.
- Existing GitHub Actions deployment workflow.

Existing API paths include:

- `functions/api/auth/`
- `functions/api/admin/`
- `functions/api/submissions/`

These should be assessed and extended rather than unnecessarily replaced.

## Existing configuration mismatch

The supplied `.github/workflows/deploy.yml` currently deploys to GitHub Pages when `main` receives a push.

The README also describes GitHub Pages hosting.

Our agreed target is Cloudflare Pages and Workers.

This migration must be handled carefully so the existing public website does not accidentally receive two competing deployment configurations.

# 18. Development phases

## Phase 1 — Foundation

- Verify the development branch.
- Verify Cloudflare project configuration.
- Establish D1 database and migrations.
- Establish authentication.
- Establish role and section permissions.
- Secure backend API structure.

## Phase 2 — Content management

- Build all 11 content-management areas.
- Integrate existing GitHub content.
- Implement persistent D1 records.
- Implement image management.
- Integrate Tiptap.
- Preserve Markdown and JSON compatibility.

## Phase 3 — Editorial workflow

- Implement temporary Article and Guideline submissions.
- Implement approval and rejection.
- Implement revision and resubmission.
- Implement edit requests.
- Implement deletion requests.
- Implement administrator decisions.

## Phase 4 — Dashboard

- Complete administrator dashboard.
- Complete editor dashboard.
- Implement activity feeds.
- Implement notifications.
- Implement account management.
- Implement permission management.

## Phase 5 — GitHub integration

- Implement secure GitHub publishing.
- Implement approved content commits.
- Implement publishing verification.
- Implement failure handling.
- Implement deployment-status tracking.

## Phase 6 — Testing and release

- Test permissions.
- Test every content type.
- Test submission workflows.
- Test rejection and resubmission.
- Test edit and deletion approvals.
- Test GitHub commits.
- Test build and deployment failures.
- Run the complete production build.
- Obtain explicit authorization before merging into main.

---

# 19. Unresolved requirements and decisions

The following questions must be answered before their respective features are finalized.

## A. Persistent content synchronization

**Important — architectural decision required.**

When an administrator approves a new Author, Topic, Team member or other persistent content change:

Should the portal:

1. Store the canonical record in D1 and automatically synchronize the approved change into GitHub for website publication, while retaining the D1 record?
2. Store the canonical record in D1 and generate the public website directly from D1?

The first option is more compatible with the existing Astro Markdown-based website.

## B. Existing persistent content migration

Existing Authors, Topics, Team, Student Collaborators, Newsletter, Programs and Announcements currently live in GitHub.

Should these records be imported into D1 once during initial setup?

My recommendation: yes, with an explicit migration and reconciliation process that prevents duplicate records.

## C. Rejected persistent content requests

When an editor's proposed edit or deletion is rejected, should the editor be able to revise and resubmit the same request, or must they create a new request?

## D. Moderator authority

Can a moderator approve a submission and immediately trigger publication, or must the administrator perform a final confirmation before publication?

## E. Multiple editor visibility

We have agreed that editors can see other editors' activity within assigned sections.

Should they also be able to read the complete contents of other editors' pending Article and Guideline submissions, or see only their titles, authors, dates and statuses?

## F. Article and Guideline publication failure

We have agreed that failed builds must not lose approved content.

We still need to establish whether a successful GitHub commit is sufficient to remove the temporary submission, even when the website deployment subsequently fails.

Recommended approach: preserve the approved payload or a recoverable publication copy until the publication operation is verified, then retain the audit record permanently.

## G. Article and Guideline existing content

Should administrators have the ability to create, edit and delete existing Articles and Guidelines directly through the portal, or should they also use the GitHub publication mechanism for these actions?

The current agreed workflow establishes that editors cannot modify existing articles or guidelines.

## H. Deletion safeguards

Should administrator deletion of persistent content be permanent, or should deleted records enter a recoverable archive/trash period?

Recommended approach: soft deletion with administrator-controlled recovery.

## I. Asset storage

Should portal-uploaded assets be stored in Cloudflare R2 until approval, then copied into the website's GitHub asset directories?

This would avoid putting unpublished assets into the public repository.

## J. Publication timing

Should accepted content be published immediately after GitHub commit and successful deployment, or should the administrator be able to choose a scheduled publication date?

---

# 20. Non-negotiable project rules

1. Development happens only on `editorial-portal-development`.
2. Do not merge into `main` without explicit authorization.
3. Editors never receive GitHub repository access.
4. Editors cannot approve their own submissions.
5. Editors cannot directly edit or delete existing content.
6. Administrator has final authority.
7. Articles and Guidelines are temporary D1 submissions, not persistent portal content.
8. Existing published Articles and Guidelines remain in GitHub, not D1.
9. The other nine content areas are persistent portal content.
10. Every approval, rejection and important action must be recorded.
11. Notifications are in-app only.
12. Editors cannot modify activity records.
13. Existing website metadata and content must be preserved.
14. Failed publishing operations must remain recoverable.
15. Every development release must pass the required build checks.
16. Never silently discard approved content or existing website data.

---

**End of working specification**

This document is the agreed baseline for future development. Unresolved decisions must be settled before implementing the corresponding functionality.
