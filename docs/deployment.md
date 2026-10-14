# Deployment: DEV → QA → UAT → LIVE on Vercel

Appsgain runs as two Vercel projects built from this repository, the **web app** (`apps/web`)
and the **API** (`apps/api`). Each project runs in four environments. Every environment has
its own Git branch, its own subdomains, its own settings and its own Neon Postgres database.
A change reaches real users only after it has passed through DEV, QA and UAT, in that order.

`appsgain.app` stands in for the domain until one is bought. Where it appears below,
substitute the real domain.

## The four environments

| | DEV | QA | UAT | LIVE |
| --- | --- | --- | --- | --- |
| Git branch | `develop` | `qa` | `uat` | `main` |
| Web app | dev.appsgain.app | qa.appsgain.app | uat.appsgain.app | app.appsgain.app |
| API | api-dev.appsgain.app | api-qa.appsgain.app | api-uat.appsgain.app | api.appsgain.app |
| Neon branch (database) | `dev` | `qa` | `uat` | `main` |
| Vercel environment | Preview, branch `develop` | Preview, branch `qa` | Preview, branch `uat` | Production |
| Used by | Developers | QA testers | The client and stakeholders | Real users |
| Access | Password gate | Password gate | Password gate | Public |
| Background jobs | GitHub Actions, every 5 min | GitHub Actions, every 5 min | GitHub Actions, every 5 min | GitHub Actions, every 5 min, plus Vercel Cron (daily on Hobby, every minute on Pro) |

**How a change moves.**
1. A feature branch is merged into `develop` and deploys to DEV.
2. A pull request from `develop` into `qa` starts a QA cycle.
3. A pull request from `qa` into `uat` hands a QA-approved build to the client.
4. A pull request from `uat` into `main` releases it to LIVE, once the client has signed off.

Vercel builds only these four branches (`scripts/vercel-ignore-build.mjs`). The GitHub check
**Promotion order** rejects any other path, such as `develop` straight into `main`.

## What you need before starting

- **A Vercel account.** The free Hobby plan is enough to build and test all four
  environments. Move to **Pro** before real customers use LIVE:
  - Vercel's Hobby plan is for personal, non-commercial use.
  - Pro lets Vercel Cron run LIVE's background jobs every minute. On Hobby it runs them once
    a day, and the GitHub workflow covers the rest (see "Background jobs").
  - To switch, change the schedule in `apps/api/vercel.json` to `* * * * *` after upgrading.
    A Hobby deployment with that schedule fails.
- **Neon** for Postgres, either through the Vercel Marketplace or neon.com directly.
- **The domain**, and access to its DNS settings.
- **An email provider** (Resend or SendGrid) with a verified sender address.
  - On Vercel the API runs in production mode in all four environments.
  - In production mode the development `log` email driver is refused.
  - Without a provider, password resets, verification codes and invitations are never sent.
- **Admin access to the GitHub repository**, for branch protection and secrets.

## One-time setup

### 1. Create the environment branches

```bash
git checkout main && git pull
git push origin main:develop main:qa main:uat
```

### 2. Create the databases (Neon)

1. **Create a Neon project.**
   - Pick the region closest to your users.
   - In Vercel, set both projects' Function Region (Settings → Functions) to the matching
     region, so each API call stays in one place.
2. **Use the default `main` branch for LIVE.** Create the branches `uat`, `qa` and `dev`
   from it.
   - Do this now, while LIVE is still empty.
   - Once LIVE holds customer data, never branch the test environments from it again. Fill
     them with seed data instead (see "Database changes").
3. **Copy two connection strings for each branch.** Use the **Connect** dialog, with
   connection pooling on and then off.
   - Pooled (the host contains `-pooler`) → `DATABASE_URL`.
   - Direct → `DATABASE_URL_UNPOOLED`.
   - Append `&connect_timeout=15` to both. Neon pauses idle databases, and the first
     connection after a pause takes a few seconds.

The first deployment of each API environment creates its tables (see step 3).

### 3. Create the API project on Vercel

1. Go to **Add New → Project** and import this repository.
2. Set **Root Directory** to `apps/api`. Vercel detects NestJS.
3. Set **Settings → Build and Deployment → Node.js Version** to `22.x`.
4. Leave the build settings alone. `apps/api/vercel.json` supplies them:
   - the install and build commands (the build checks settings, builds the shared package,
     generates Prisma and runs migrations)
   - the branch filter
   - LIVE's Vercel Cron (daily; every minute once on Pro)
5. Set **Settings → Deployment Protection** to **None**.
   - The API has its own sign-in.
   - Vercel's protection would block the web app's calls to the DEV, QA and UAT APIs.
6. **Settings → Environment Variables:** add one set per environment from
   [`deploy/vercel/api.env.example`](../deploy/vercel/api.env.example):
   - LIVE → Production
   - UAT, QA and DEV → Preview, with the Git branch `uat`, `qa` or `develop`
7. **Settings → Domains:**
   - add `api.appsgain.app` for Production
   - add `api-uat.appsgain.app`, `api-qa.appsgain.app` and `api-dev.appsgain.app`, each as
     **Preview** with its Git branch

### 4. Create the web project on Vercel

1. Import the same repository again, with **Root Directory** `apps/web` (Next.js) and
   Node.js `22.x`.
2. Set **Deployment Protection** to **None**.
   - The app's own password gate protects DEV, QA and UAT, and testers and the client
     don't need Vercel accounts.
   - Alternatively, keep Vercel Authentication if only your own team ever opens DEV and QA.
     You would still need the gate on UAT for the client.
3. Add the environment variables from
   [`deploy/vercel/web.env.example`](../deploy/vercel/web.env.example), mapped the same way.
   - Set `ACCESS_GATE_USERNAME` and `ACCESS_GATE_PASSWORD` on DEV, QA and UAT only, with a
     different password for each.
   - Never set them on LIVE.
4. Add the domains:
   - `app.appsgain.app` for Production
   - `www.appsgain.app`, redirecting to it
   - `uat.appsgain.app`, `qa.appsgain.app` and `dev.appsgain.app`, as Preview on their
     branches

### 5. DNS

For each domain above, add the record Vercel shows on the Domains page. For subdomains this
is usually a CNAME to Vercel. Vercel issues and renews the SSL certificates itself.

### 6. GitHub

1. **Branch protection** (Settings → Branches), on `develop`, `qa`, `uat` and `main`:
   - require a pull request before merging, with at least one approval
   - require the status checks **Checks**, **API integration tests** and
     **Web production build**; on `qa`, `uat` and `main`, also **Promotion order**
   - hold back on requiring **API integration tests** until four of its tests are updated.
     As of 2026-09-30 they expect older responses: 400 or 404 where the API now answers
     403, zero rows where the tenant filter returns the caller's own rows, and a different
     sign-up monogram. Until then that job fails on every run.
   - block force pushes and deletions
   - on `main`, limit who may approve to the people allowed to confirm a client sign-off

   Branch protection is free on public repositories. On a private repository it needs a
   paid GitHub plan.
2. **Actions secrets** (Settings → Secrets and variables → Actions), for the
   "Background jobs" workflow:
   - `DEV_API_URL` and `DEV_CRON_SECRET`
   - `QA_API_URL` and `QA_CRON_SECRET`
   - `UAT_API_URL` and `UAT_CRON_SECRET`
   - `LIVE_API_URL` and `LIVE_CRON_SECRET`

   Each URL is that environment's API address. Each secret is the `CRON_SECRET` set on that
   environment's API.

### 7. First deployment

1. Push to `develop` (or redeploy it) to create DEV.
2. Check `https://api-dev.appsgain.app/api/health/ready`. It should return
   `{"status":"ok","database":"up"}`.
3. Seed demo data if you want it:

   ```bash
   # bash
   DATABASE_URL="<DEV direct connection string>" npm run db:seed
   ```

   ```powershell
   # PowerShell
   $env:DATABASE_URL="<DEV direct connection string>"; npm run db:seed
   ```

   The seed accounts share the password printed in the README. Change them, or leave UAT
   unseeded, before the client gets access.
4. Promote to QA, UAT and LIVE the normal way, through pull requests.

## Environment variables

Every environment gets its own value for each variable. Test secrets must never work on
LIVE. The templates in `deploy/vercel/` list every variable with notes. These are the ones
that change per environment:

| Variable | Project | DEV | QA | UAT | LIVE |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | API | Neon `dev` | Neon `qa` | Neon `uat` | Neon `main` |
| `WEB_APP_URL`, `API_CORS_ORIGINS` | API | https://dev.appsgain.app | https://qa… | https://uat… | https://app.appsgain.app |
| `API_PUBLIC_URL` | API | https://api-dev.appsgain.app | https://api-qa… | https://api-uat… | https://api.appsgain.app |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET` | API | unique | unique | unique | unique |
| `MAIL_DRIVER`, `MAIL_API_KEY`, `MAIL_FROM` | API | test sender | test sender | real sender | real sender |
| `NEXT_PUBLIC_API_URL` | Web | https://api-dev.appsgain.app | https://api-qa… | https://api-uat… | https://api.appsgain.app |
| `ACCESS_GATE_USERNAME`, `ACCESS_GATE_PASSWORD` | Web | set | set | set | **not set** |
| `CLERK_SECRET_KEY` (API), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Web) | both | Clerk development instance | development | development | production instance once there is a domain; until then **not set** is recommended (see "A development instance until there is a domain") |

Generate secrets with `openssl rand -base64 48`.

If a required setting is missing or weak, the API **build fails** with a message naming it.
This covers the database URL, the JWT secrets, `CREDENTIALS_ENCRYPTION_KEY`,
`API_CORS_ORIGINS` and `WEB_APP_URL`. An environment is never left broken behind a
successful deployment.

A changed variable takes effect only on the next deployment of that branch (use Redeploy).

## Access control

- **DEV, QA and UAT web apps** sit behind a browser password prompt (`apps/web/middleware.ts`).
  - Each environment has its own password. Share it only with the people who use that
    environment.
  - Pages there also carry `noindex`, so a leaked link doesn't end up in search results.
- **All four APIs** are reachable only with a signed-in user's token or an API key, as in
  development.
  - The one exception is `/api/internal/cron/integrations`, which needs `CRON_SECRET`.
- **LIVE** is public; the product's own sign-in protects the data.
- **Accounts:** turn on two-factor authentication for everyone with access to Vercel, Neon
  and GitHub. Give Vercel's Production-deploy and rollback rights only to people who may
  release.

## Google and Microsoft sign-in (Clerk)

"Continue with Google" and "Continue with Microsoft" on the sign-in and sign-up pages go
through [Clerk](https://clerk.com). Clerk only confirms that the person controls a verified
email address. Accounts, workspaces, roles, two-factor authentication and sessions stay
Appsgain's own. The API revokes each Clerk session as it reads it, and the browser signs
out of Clerk as well, so no Clerk session outlives the sign-in. Email and password sign-in
is unchanged.

**How a sign-in goes.**
1. The button notes in the tab that a sign-in has started, and sends the browser through
   Clerk to Google or Microsoft.
2. Clerk returns to `/sign-in/sso-complete`. Someone Clerk has not seen before passes through
   `/sign-in/sso-callback` first, where Clerk creates its record of them. Both pages carry on
   only in a tab that started a sign-in; opened any other way, they end whatever Clerk session
   the browser has and go back to the sign-in page.
3. That page sends Clerk's short-lived token, and the workspace typed on the sign-in form, to
   `POST /api/auth/sso/clerk`. The API checks it, takes the Google or Microsoft account's
   primary email (only if it is verified) and answers:
   - one account with that email: signed in, or the usual 2FA code step if the account has 2FA
   - accounts in several workspaces: a list to pick from
   - no account: the sign-up form, with name and email filled in and no password to choose.
     It also says when the address belongs to an account that was turned off, or has an
     invitation waiting.
4. An account whose email was never confirmed is never opened straight away: anyone can sign
   up with someone else's address and wait. The page shows the workspace with its other
   members, pending invitations, API keys and webhooks, and offers to create a new workspace
   instead. Opening it replaces its password, removes its 2FA and ends its other sessions,
   and the page then says what to look over under Settings → Team and Integrations.

**Accounts without a password.** An owner who signed up with Google or Microsoft has no
password. They can set one under Settings → Security within 30 minutes of signing in, with
no email needed; after that they sign in again first. "Forgot password" works too, once
`MAIL_*` is configured. Two-factor authentication needs a password, so Settings asks for one
first.

### Setting it up

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
   - Sign-in and sign-up with **email address** only; leave phone number off.
   - Leave **username** and **consent to legal documents** off too. The pages here have no
     screen to ask for them, so a first Google or Microsoft sign-in would stop half-way.
     (Appsgain's own sign-up form asks for the terms.)
   - Under **SSO connections**, turn on **Google** and **Microsoft**.
   - Clerk's bot protection can stay on. When it challenges a first-time visitor, the
     challenge appears over `/sign-in/sso-callback`.
   - On a **development instance**, turn **Test mode** off (instance settings in the Clerk
     dashboard). Test mode treats any address with `+clerk_test` in it as verified without
     sending an email. The API refuses those addresses anyway.
2. Copy the **Publishable key** and the **Secret key** from the **API keys** page into the
   Vercel projects:

   | Variable | Project | Value |
   | --- | --- | --- |
   | `CLERK_SECRET_KEY` | API | Secret key: `sk_test_…` (development), `sk_live_…` (production) |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | Publishable key: `pk_test_…` or `pk_live_…` |
   | `CLERK_JWT_KEY` (optional) | API | The **PEM public key** from the same page. The API then checks tokens without calling Clerk. |

   - Both keys must come from the same Clerk instance.
   - The publishable key is built into the pages, so redeploy the web project after changing it.
3. **The web app's exact address must be in the API's `API_CORS_ORIGINS`** (or be its
   `WEB_APP_URL`). The API refuses Clerk tokens obtained on any other origin, so a Vercel
   preview URL that is not listed gets "could not be confirmed".
4. Locally, the secret key goes in `.env` and the publishable key in `apps/web/.env.local`.
   `http://localhost:3000` and `http://localhost:3001` are already allowed origins.

Without the keys, the two buttons stay disabled and `/api/auth/sso/*` answers 503 with a
message pointing to email sign-in. Deploying the code before the keys exist is safe.

### A development instance until there is a domain

A Clerk production instance needs a domain you control, because Clerk serves part of the
sign-in from a subdomain of it (DNS records on the Clerk **Domains** page). A
`*.vercel.app` address cannot be used for that. Until the domain is bought, every
environment, LIVE included, uses the **development instance** (`pk_test_`, `sk_test_`).

- It works end to end, and nothing in the code depends on which kind of instance it is.
- Google and Microsoft use Clerk's shared OAuth credentials, so their consent screens do not
  show Appsgain's name.
- **A development instance holds at most 100 users.** Everyone who has ever used either
  button counts, although Appsgain ends their Clerk session straight away. After that, a
  newcomer's Google or Microsoft sign-in fails at Clerk (email and password still work).
  Appsgain does not need the users Clerk keeps, so deleting old ones on the Clerk **Users**
  page makes room.
- It breaks the rule that test keys never work on LIVE. Move LIVE to a production instance as
  soon as there is a domain. Users cannot be moved between Clerk instances, which does not
  matter here: Appsgain's accounts are its own.

**The security risk, and the recommendation.** A development instance keeps the browser's
Clerk client in a value (`__clerk_db_jwt`) that it accepts from the address bar. Clerk says
this is not secure enough for production. Without protection, anyone who got a person to
open a crafted `/sign-in` link would share that person's Clerk client. They could then read
the token of that person's next Google or Microsoft sign-in and use it to take over the
Appsgain account (any account without 2FA, and new sign-ups too). Or they could sign the
person in to an account the attacker controls.

The code now defends against this:
- Every page that loads Clerk removes the value from the address before Clerk reads it. The
  only exception is a return page in a tab that has just started a sign-in.
- The return pages only carry on in a tab that started a sign-in.
- The API revokes each Clerk session the moment it trades it.

One case is left. A malicious site could open the sign-in page in a window it keeps control
of, get the person to press the button there, and then send that window to the return page
with its own Clerk client. That person would end up signed in to the attacker's account (or
signing up under the attacker's address). It does not give access to the person's own account.

**Recommendation:** leave `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` off the
LIVE (Production) projects until a Clerk production instance on Appsgain's own domain exists.
A production instance keeps the client in an HttpOnly cookie on Clerk's subdomain, which no
link can set. Keep the development keys on DEV, QA and UAT, which sit behind the password
prompt. If LIVE must have Google and Microsoft sign-in before then, the owner accepts the
remaining risk described above.

### Moving LIVE to a production instance

1. In the Clerk dashboard, create the **production instance** for the same application. SSO
   connection settings are not copied from development, so set them again there.
2. Add the domain the web app is served from (for example `app.appsgain.app`) and create the
   DNS records Clerk lists on its **Domains** page. When they are verified, deploy the
   certificates from the Clerk dashboard.
3. **Google:** in Google Cloud Console, create an OAuth client of type *Web application*.
   Add the web app's address under **Authorized JavaScript origins** and the **Authorized
   redirect URI** Clerk shows on its Google connection page. Paste the client ID and secret
   into that page (custom credentials) and publish the OAuth consent screen.
4. **Microsoft:** in Microsoft Entra ID, register an app for accounts in any organisation and
   personal Microsoft accounts, add Clerk's redirect URI as a *Web* redirect URI, create a
   client secret and paste the client ID and secret into Clerk's Microsoft connection.
   - Add the `xms_edov` optional claim as Clerk's Microsoft guide describes. Without it, Clerk
     marks Microsoft addresses as unverified and the API refuses every Microsoft sign-in.
   - Microsoft client secrets expire after at most 24 months. Note the date and renew it
     before then, or Microsoft sign-in stops working.
5. Put the `pk_live_` and `sk_live_` keys on the **Production** environment of the web and API
   projects, keep the development keys on DEV, QA and UAT, and redeploy both projects.
6. On LIVE, sign in with a Google account and with a Microsoft account, and sign up once with
   an address that has no account yet.

## Background jobs

The API retries failed webhook deliveries and announces follow-ups as they come due. Locally
that runs on a 30-second timer. On Vercel no timer survives between requests, so the timer
is off and a scheduler calls `/api/internal/cron/integrations` instead:

- **All four environments: the "Background jobs" GitHub workflow, every 5 minutes.** Each
  run calls every environment whose URL and secret are set. A failed call marks the run
  red.
  - GitHub may start scheduled runs late.
  - Scheduled runs happen only from `main`.
  - In a public repository, GitHub pauses the schedule after 60 days without commits.
  - On a private repository these runs use Actions minutes. Lower the schedule, or move the
    calls to an external cron service.
- **LIVE, additionally: Vercel Cron.** The schedule is in `apps/api/vercel.json`.
  - On Hobby it runs once a day, as a backup in case the GitHub schedule pauses.
  - On Pro, change it to `* * * * *` so LIVE's jobs run every minute.
  - Vercel Cron only ever runs on production deployments.
  - Runs are listed under the API project's **Settings → Cron Jobs**.

Detached work, such as a webhook sent after the response has gone, is kept alive with
Vercel's `waitUntil` (`apps/api/src/runtime/vercel.ts`). It finishes instead of being
suspended with the function.

## Database changes

- **Migrations run automatically** in each environment's API build, before that
  deployment starts serving (`apps/api/scripts/vercel-build.mjs`). They use the direct
  connection (`DATABASE_URL_UNPOOLED`).
- **Keep every migration backward compatible.** While a new deployment builds and after it
  goes live, the previous version may still be serving, and a rollback puts the old code in
  front of the new schema.
  - Add new columns as nullable or with a default.
  - Remove old columns in a later release, once no deployed code reads them.
- **Test environments get seed data, never copies of LIVE.** Customer data does not leave
  production.
- To build without touching the database (for example during a restore), set
  `SKIP_DB_MIGRATIONS=1` on that environment and redeploy.

## Releasing

1. **Feature work:** branch from `develop`, open a pull request back into `develop`, merge
   once CI passes. DEV updates within minutes.
2. **Start a QA cycle:** open a pull request `develop` → `qa`.
   - QA tests on qa.appsgain.app and keeps the bug list: Critical, High, Medium, Low.
   - Fixes go into `develop` and come through again the same way.
3. **Hand over to UAT:** once there are no open Critical or High bugs, open `qa` → `uat`
   with the QA Testing Report linked.
   - The client tests on uat.appsgain.app.
   - Log client feedback, bugs and change requests separately.
   - Fixes follow the same path. New features wait for a change request.
4. **Release:** after the client's formal UAT sign-off, open `uat` → `main` with the sign-off
   linked (the pull request template has the checklist). Merging deploys LIVE.
5. **Smoke test LIVE** straight away:
   - `https://api.appsgain.app/api/health/ready` answers `{"status":"ok","database":"up"}`
   - sign in, open the dashboard and leads, create and delete a test lead
   - request a password reset for your own account and receive the email
   - "Continue with Google" signs you in, once Clerk is set up (see "Google and Microsoft
     sign-in")
   - the next "Background jobs" run in GitHub Actions shows LIVE succeeding

Urgent fixes take the same path, just quickly. There is no direct route to `main`.

## Rollback

- **Code:** Vercel → project → **Instant Rollback** points the domains back at an earlier
  production deployment within seconds.
  - Roll back the web app and the API together if the release changed both.
  - After a rollback, Vercel stops putting new `main` deployments live until someone clicks
    **Undo Rollback** (or runs `vercel promote`).
  - A rollback does not restore environment variables.
  - Pro can return to any earlier production deployment; Hobby only to the one before.
- **Database:** rolling back code never rolls back a migration, which is why migrations
  stay backward compatible.
  - Before a release with a risky migration, create a Neon branch of `main` named for the
    release (for example `pre-release-2026-10-01`) as a restore point.
  - Neon can also restore a branch to an earlier point in time, within your plan's history
    window. That discards everything written since, so use it only as a last resort.
- **Off-site backups:** if you want database dumps kept outside Neon, store them in private
  storage. Never put them in GitHub Actions artifacts while the repository is public.

## Monitoring

- **Errors and logs:** Vercel's Logs and Observability, on both projects.
- **Uptime:** an external monitor (for example Better Stack or UptimeRobot) on
  `https://api.appsgain.app/api/health/ready` and `https://app.appsgain.app`, alerting by
  email or chat.
- **Background jobs:** the "Background jobs" run history in GitHub Actions (all
  environments), and the Vercel cron log (LIVE).
- **Analytics:** Vercel Web Analytics on the web project, if wanted.

## Limits to know

- **4.5 MB** is the most one API request or response can carry on Vercel Functions. A larger
  CSV import has to be split.
- **300 seconds** is the default time limit for one API call; Pro can raise it to 800.
- **Four limits are held in memory:** reset emails, verification-code emails,
  verification-code guesses and Google or Microsoft sign-ins (30 a minute per network
  address). Each function instance keeps its own count, and on Vercel several instances can
  run at once. That makes the limits looser than on one server,
  guesses included. Sign-in lockouts are stored in the database and are not affected.
  Moving these counts into the database or Redis is worth doing before LIVE.
- **Live call audio** will need WebSockets. Vercel Functions support them only in beta
  (June 2026); revisit this when telephony is built.
- **`apps/ai-service`** (Python) is not deployed. It is still a stub, and the API does not
  call it yet.
- **Vercel Pro allows one Custom Environment per project.** This setup uses Preview branches
  instead, which work on every plan and behave the same way for DEV, QA and UAT.
