# SP Navigators Attendance Bot

Telegram bot ([@spnav_bot](https://t.me/spnav_bot)) for SP Navigators members to RSVP to events, with leaders tracking attendance and members synced to a Google Sheet.

Runs on **Cloudflare Workers** + **Workers KV**. Google Sheet updates go through a small **Google Apps Script**.

## What it does

- **Members** — register with an invite code, pick their team (**Restorer** brothers / **Hesed** sisters), then RSVP ✅/❌ to every upcoming event from one message
- **Leaders** — for their own team: view attendance per event, copy a WhatsApp summary (choice of formats or a custom template), add/remove members, mark attendance for members without Telegram
- **Admins** — add events for both teams or one (Nav+U, Prayer Walk, VTP or custom) with date, time and location; edit each team's ministry groups; change the invite code; sync the Google Sheet
- **Creator** — gets an alert whenever someone new registers

The whole bot lives in a single message that updates as you tap buttons.

## Guides

| Who | Guide |
|---|---|
| Admins | [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) |
| Leaders | [docs/LEADER_GUIDE.md](docs/LEADER_GUIDE.md) |
| Overview (screens, settings, data) | [docs/BOT_OVERVIEW.md](docs/BOT_OVERVIEW.md) |
| Developers | [docs/DEV_GUIDE.md](docs/DEV_GUIDE.md) |
| Google Sheet script | [apps-script/README.md](apps-script/README.md) |
| Privacy policy | [docs/PRIVACY.md](docs/PRIVACY.md) |
| What changed | [CHANGELOG.md](CHANGELOG.md) |

Word copies of the Leader and Admin guides (to upload as Google Docs) are in [guides-for-google-docs/](guides-for-google-docs/). Rebuild them after editing the guides with `npm run guides`.

## Project layout

```
src/index.js        The bot (deployed)
src/archive/        Older versions, not deployed
apps-script/        Google Apps Script for the member sheet
test/               Simulated tests (npm test)
docs/               Guides
guides-for-google-docs/  Word copies of the guides for Google Docs
tools/              md2docx.js (builds those Word copies)
wrangler.jsonc      Cloudflare config
```

## Quick commands

```bash
npm install          # first time only
npm test             # run the simulated tests
npm run guides       # rebuild the Word/Google Docs guides
npx wrangler deploy  # deploy the bot
npx wrangler tail    # watch live logs
```

## Secrets

Set with `npx wrangler secret put <NAME>` — never commit them:

`BOT_TOKEN`, `ADMIN_USER_ID`, `ADMIN_PASSWORD`, `LEADER_PASSWORD`, `INVITE_CODE`, `APPS_SCRIPT_URL`, `SHEET_SECRET` (and optional `ADMIN_NAME`).

See [docs/BOT_OVERVIEW.md](docs/BOT_OVERVIEW.md) for what each one does.
