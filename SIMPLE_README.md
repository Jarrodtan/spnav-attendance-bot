# SP Navigators Attendance Bot — Interactive Version
### multi_index.js v3 (previous single-event version: simple_index.js, archived)

A fully button-based interactive Telegram bot. Only ONE persistent message exists in chat — all navigation happens by editing that single message.

---

## What's New in v3 — Multiple Events

- **Several events at once** — every open event shows on the home screen with your status
- **One-tap RSVP** — ✅ / ❌ buttons per event on the home screen; no RSVP or My Status screens
- **🗓 Manage Events** (admin) — add from presets (Weekly Nav+U, Prayer Walk, VTP) or a custom name; rename, change date & time, cancel/reopen, clear RSVPs, delete — per event
- **Date & time in one input**, e.g. `Fri 17 Oct, 5:30pm`
- **Removed:** Week Mode, Auto Date, global Clear RSVPs, "deleted immediately" wording
- View List / WhatsApp / Mark Attendance work per event
- Upgrading: on first run the old single event becomes the first event; old RSVPs are cleared

## What's New in v2.1

- **Google Sheet stays in sync** — register, add and remove all update the sheet; admin **📊 Sync Sheet** rebuilds it
- **Remove Member** works for all members (Telegram + non-Telegram) and deletes their sheet row
- **New-member alert** to the creator, with the main menu re-sent below it
- Sheet requests are authenticated with `SHEET_SECRET`
- `/setup` route removed (it exposed the bot token)

## What's New in v2

- Leaders can add non-Telegram members and mark their attendance manually
- ~~Admin receives NO Telegram notification on registration~~ (changed in v2.1)
- Manage Members screen for leaders
- All Members screen for admin shows group alongside name

---

## How It Works

```
User types /start
      ↓
Bot sends ONE message
      ↓
User taps buttons
      ↓
Same message UPDATES
      ↓
Chat stays clean — only 1 message forever
```

> Exception: the creator also gets 🔔 new-member alerts; their menu is re-sent below each alert.

---

## Screens

| Screen | Who | How to reach |
|---|---|---|
| Welcome | Strangers | First /start |
| Register | Strangers | Tap "I have invite code" |
| Home | All members | After registration / Back |
| My Profile | Members | My Profile button |
| Login | Members | Login button |
| View List | Leaders + Admin | View List button |
| WhatsApp | Leaders + Admin | WhatsApp button |
| Manage Members | Leaders + Admin | Manage Members button |
| Mark Attendance | Leaders + Admin | Inside Manage Members |
| Remove Member | Leaders + Admin | Inside Manage Members (all members) |
| Manage Events | Admin | Manage Events button |
| Add Event | Admin | Inside Manage Events |
| Event detail | Admin | Tap an event in Manage Events |
| All Members | Admin | All Members button |
| Sync Sheet | Admin | Sync Sheet button (action, no screen) |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | Telegram bot token |
| `ADMIN_USER_ID` | ✅ | Your Telegram user ID |
| `ADMIN_PASSWORD` | ✅ | Admin login password |
| `LEADER_PASSWORD` | ✅ | Leader login password |
| `INVITE_CODE` | ✅ | Member invite code |
| `ADMIN_NAME` | Optional | Admin display name |
| `APPS_SCRIPT_URL` | Optional | Google Apps Script web app `/exec` URL |
| `SHEET_SECRET` | With sheet | Shared password; must match Apps Script's Script Property |

---

## KV Keys

| Key | Value | Description |
|---|---|---|
| `name_{userId}` | String | Registered name |
| `approved_{userId}` | `"true"` | User approved |
| `role_{userId}` | `"member/leader/admin"` | Role |
| `group_{userId}` | String | Ministry group |
| `rsvp_{eventId}_{userId}` | `"coming/notcoming"` | RSVP for one event |
| `main_msg_{userId}` | Number | Persistent message ID |
| `input_pending_{userId}` | String | Awaiting text input (5min TTL) |
| `reg_pending_{userId}` | JSON | Temp registration data (10min TTL) |
| `add_member_pending_{userId}` | String | Temp name for non-tele member (5min TTL) |
| `events` | JSON | `[{ id, name, when, active }]` — all events |
| `new_event_pending_{userId}` | String | Event name while admin types date & time (5min TTL) |

---

## Switch Versions

Edit `wrangler.jsonc`:
```jsonc
"main": "src/multi_index.js",    // multi-event version (current)
"main": "src/simple_index.js",   // single-event version (archived)
"main": "src/index.js",          // command version
```
Then `npx wrangler deploy`.
