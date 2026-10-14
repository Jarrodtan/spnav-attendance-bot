# Google Apps Script — Member Sheet

`Code.gs` receives member updates from the bot and writes them to the **SP Navigators Members** Google Sheet.

## Sheet columns

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| S/N | Name (Registered with bot) | Team | Ministry Group | Telegram Username | Telegram Display Name | Date Joined | User ID |

Most-used columns first (who, which team, which group, how to contact), technical ones last.

**The script arranges the columns itself.** If row 1 doesn't match this order (e.g. an older layout), the first request moves every column into place by matching the header names — no data is lost. Existing rows get their Team filled in by **📊 Sync Sheet**. Make a copy of the sheet first if you want a backup (**File → Make a copy**).

The headers must keep these exact names, or the script will treat them as new columns.

## Setup

1. Open the sheet → **Extensions → Apps Script**
2. Paste `Code.gs` and save
3. Set `SHEET_NAME` at the top to the tab name (currently `Database`)
4. **Project Settings → Script Properties** → add `SHEET_SECRET` (same value as the Worker's `SHEET_SECRET`)
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (the secret keeps outsiders out)
6. Copy the `/exec` URL → `npx wrangler secret put APPS_SCRIPT_URL`

## Updating the script

After editing: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.
The URL stays the same. Old deployments can only be archived, not deleted — that's fine.

## What it handles

| Request from bot | Effect |
|---|---|
| Register / add member | Add a row, or update the existing row with that User ID |
| Remove member | Delete the row, renumber S/N |
| 📊 Sync Sheet | Rewrite all rows to match the bot (keeps Display Name, Username, Date Joined) |

## Troubleshooting

Run `npx wrangler tail` and look for `Apps Script rejected`:

- `unauthorized` → `SHEET_SECRET` doesn't match between the Worker and Script Properties
- `sheet not found` → `SHEET_NAME` doesn't match the tab name
- no line at all → `APPS_SCRIPT_URL` isn't set on the Worker
