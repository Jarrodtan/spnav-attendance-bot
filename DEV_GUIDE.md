# Developer Guide
### SP Navigators Attendance Bot — Technical Reference v2

---

## Project Structure

```
spnav-bot/
├── src/multi_index.js     ← Multi-event button-based bot (current — deployed)
├── src/simple_index.js    ← Single-event version (archived, for rollback)
├── src/index.js           ← Command-based bot (backup, NOT deployed)
├── src/archive_index.js   ← Old complex multi-event version
├── Code.gs                ← Google Apps Script (paste into the sheet's script editor)
├── wrangler.jsonc         ← Cloudflare config ("main" decides which file runs)
├── package.json           ← npm scripts
└── docs/
    ├── SIMPLE_README.md
    ├── DEV_GUIDE.md       ← This file
    ├── USER_GUIDE.md
    ├── LEADER_GUIDE.md
    ├── ADMIN_GUIDE.md
    ├── SETUP.md
    ├── DEPLOY.md
    └── TROUBLESHOOT.md
```

---

## Architecture

```
Telegram User
      ↓ message / button tap
Telegram API
      ↓ POST to webhook URL
Cloudflare Worker (multi_index.js)
      ↓ reads/writes
Cloudflare KV (ATTENDANCE_KV)
      ↓ on registration
Google Apps Script (Code.gs) → Google Sheets (awaited, authenticated with SHEET_SECRET)
```

---

## Code Structure

```
multi_index.js
├── DATE HELPER
│   └── getThisFriday()
│
├── TELEGRAM API HELPERS
│   ├── sendMessage()          — new message, returns response
│   ├── sendKeyboard()         — new message with buttons, returns response
│   ├── editMessage()          — edit text only
│   ├── editMessageWithKeyboard() — edit text + buttons (main function)
│   ├── deleteMessage()        — remove a message
│   └── answerCallback()       — dismiss button loading spinner
│
├── PERSISTENT MESSAGE HELPERS
│   ├── saveMainMessageId()    — save to KV
│   └── getMainMessageId()     — get from KV
│
├── USER HELPERS
│   ├── getName()
│   ├── isApproved()
│   ├── getRole()
│   ├── isLeader()
│   └── isAdmin()
│
├── EVENT HELPERS
│   ├── getEventName()
│   ├── getEventDate()
│   ├── getEventTime()
│   ├── isEventActive()
│   ├── getEventMode()
│   └── getEventFull()
│
├── EXTERNAL SERVICES
│   ├── appendToSheet()        — add/update a sheet row (awaited)
│   ├── removeFromSheet()      — delete a sheet row by User ID
│   ├── syncSheet()            — send full member list; Apps Script rewrites the sheet
│   └── notifyAdmin()          — alert to ADMIN_USER_ID, then re-send admin's main menu below it
│
├── SCREEN BUILDERS (each returns { text, keyboard })
│   ├── buildHomeScreen()          — role-based buttons
│   ├── buildRsvpScreen()
│   ├── buildStatusScreen()
│   ├── buildProfileScreen()
│   ├── buildLoginScreen()
│   ├── buildListScreen()          — attendance list
│   ├── buildWhatsappScreen()      — WhatsApp summary
│   ├── buildManageMembersScreen() — non-telegram member management
│   ├── buildMarkAttendanceScreen()— mark non-telegram member attendance
│   ├── buildRemoveMemberScreen()  — remove any member (Telegram + non-Telegram)
│   ├── buildEventSettingsScreen() — admin event controls
│   ├── buildWeekModeScreen()      — normal/standdown/holiday
│   ├── buildMembersScreen()       — all members list (admin)
│   ├── buildGroupPickerScreen()   — group picker for registration
│   └── buildAddMemberGroupPickerScreen() — group picker for adding member
│
├── INPUT PROMPT HELPER
│   └── promptInput()          — sets input_pending + edits message
│
├── MAIN REQUEST HANDLER
│   └── handleRequest()
│
└── MAIN UPDATE HANDLER
    └── handleUpdate()
        ├── callback_query handler
        │   ├── screen_*      — navigate to screen
        │   ├── action_*      — perform action
        │   ├── input_*       — prompt for text input
        │   ├── group_*       — group selection (registration)
        │   ├── addgrp_*      — group selection (add member)
        │   ├── mark_*        — mark attendance for member
        │   ├── setatt_c_*    — set coming
        │   ├── setatt_n_*    — set not coming
        │   └── del_*         — delete non-telegram member
        └── message handler
            ├── Text input handler (invite_code, name, passwords etc.)
            └── /start command
```

---

## Callback Data Prefixes

| Prefix | Purpose | Example |
|---|---|---|
| `screen_` | Navigate to screen | `screen_home`, `screen_rsvp` |
| `action_` | Perform action | `action_rsvp_yes`, `action_clear` |
| `input_` | Prompt for text | `input_password_leader` |
| `group_` | Group during registration | `group_refresher` |
| `add_member_group_` | Group when adding member | `add_member_group_refresher` |
| `remove_member_` | Remove member (KV + sheet row) | `remove_member_709711203` |
| `action_sync_sheet` | Rebuild Google Sheet (admin) | — |
| `rsvp_y_` / `rsvp_n_` | One-tap RSVP from home | `rsvp_y_emgx2k1a` |
| `screen_events` / `screen_add_event` | Event list / add event | — |
| `ev_` | Open event detail | `ev_emgx2k1a` |
| `newev_` | Pick preset (index into PRESET_EVENTS) | `newev_0` |
| `evname_` / `evwhen_` / `evloc_` | Rename / change date & time / location | `evwhen_emgx2k1a` |
| `evskiploc` | Skip location while adding | — |
| `evoff_` / `evon_` | Cancel / reopen | `evoff_emgx2k1a` |
| `evclr_` / `evdel_` | Clear RSVPs / delete event | `evdel_emgx2k1a` |
| `markev_` | Pick event to mark attendance | `markev_emgx2k1a` |
| `mm_` | Open member for an event | `mm_emgx2k1a_nontelegram:James` |
| `sa_c_` / `sa_n_` | Set coming / not coming | `sa_c_emgx2k1a_nontelegram:James` |

> ⚠️ Telegram has a 64 **byte** limit on callback_data. Long non-Telegram names can exceed it (the button stops working) — keep names short.

---

## Non-Telegram Member Flow

```
Leader taps [➕ Add Member]
      ↓
promptInput → set input_pending = "add_member_name"
      ↓
Leader types name → message removed from chat
Save name to add_member_pending_{userId} (5min TTL)
Show buildAddMemberGroupPickerScreen
      ↓
Leader taps group (addgrp_refresher)
      ↓
Get add_member_pending from KV
Save name_nontelegram:James = "James Wong"
Save group_nontelegram:James = "Refresher"
Delete add_member_pending
Show Manage Members screen
```

**Mark attendance flow:**
```
Leader taps [📋 Mark Attendance]
      ↓
buildMarkEventPickerScreen — pick event (skipped if only one active)
      ↓
markev_{eventId} → buildMarkAttendanceScreen(eventId)
      ↓
Leader taps member (mm_{eventId}_{memberId})
      ↓
sa_c_ / sa_n_{eventId}_{memberId} → saves rsvp_{eventId}_{memberId}
```

---

## Input Pending System

| Value | Triggered by | Handles |
|---|---|---|
| `invite_code` | "I have invite code" button | Invite code check |
| `name` | After valid invite code | Name input → group picker |
| `update_name` | Profile → Update Name | Name update |
| `password_leader` | Login as Leader button | Leader password |
| `password_admin` | Login as Admin button | Admin password |
| `new_event_name` | Add Event → Custom name | Event name, then asks date & time |
| `new_event_when` | After preset/custom name | Saves `{ name, when }`, asks location |
| `new_event_location` | After date & time | Creates the event (or `evskiploc` button skips) |
| `event_location:{id}` | Event → Location | Change location (`-` clears) |
| `event_name:{id}` | Event → Rename | Rename event |
| `event_when:{id}` | Event → Date & Time | Change date & time |
| `add_member_name` | Manage Members → Add | Non-telegram member name |

All inputs expire after 5 minutes (`expirationTtl: 600` for name during registration).

---

## KV Data Model

```
User data:
  name_{userId}                    → "John Tan"
  name_nontelegram:{name}          → "James Wong"  (non-telegram member)
  approved_{userId}                → "true"
  role_{userId}                    → "member" | "leader" | "admin"
  group_{userId}                   → "Refresher"
  group_nontelegram:{name}         → "Refresher"
  rsvp_{eventId}_{userId}          → "coming" | "notcoming"
  rsvp_{eventId}_nontelegram:{name}→ "coming" | "notcoming"

UI state:
  main_msg_{userId}                → "12345678" (message ID)
  input_pending_{userId}           → "invite_code" | "name" | ... (5min TTL)
  reg_pending_{userId}             → JSON string (10min TTL)
  add_member_pending_{userId}      → "James Wong" (5min TTL)

Events:
  events                           → [{ "id": "emgx2k1a4f9", "name": "Weekly Nav+U", "when": "Fri 17 Oct, 5:30pm", "location": "SP Chapel", "active": true }]
  new_event_pending_{userId}       → "Prayer Walk", then {"name","when"} while asking location (5min TTL)
```

---

## Adding a New Screen

1. Create `buildXxxScreen()` returning `{ text, keyboard }`
2. Add button somewhere with `callback_data: "screen_xxx"`
3. Add handler:
```js
} else if (data === "screen_xxx") {
    const screen = await buildXxxScreen(env);
    await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
    return;
}
```

---

## Common Commands

```bash
npx wrangler deploy     # Deploy to production
npx wrangler tail       # Watch live logs
npx wrangler dev --remote  # Local dev with real KV
npx wrangler login      # Re-authenticate
```

---

## Known Limitations

| Limitation | Detail |
|---|---|
| 64 byte callback_data limit | Long non-Telegram member names break their buttons |
| Manual KV edits | Don't update the sheet — tap 📊 Sync Sheet afterwards |
| Sheet Display Name/Username | Not stored in KV — Sync Sheet can't restore them for rows it re-creates |
| 4096 char message limit | Large member lists may truncate |
| No message delete after 48h | Telegram API restriction |
| input_pending TTL | Expires after 5 min if user doesn't type |
| Non-telegram member IDs | Must not contain special chars that break KV keys |

---

## Google Sheet (Apps Script) API

`Code.gs` exposes one `doPost`. Every request must include `secret` (checked against Script Property `SHEET_SECRET`).

| Body | Effect |
|---|---|
| `{ name, telegram, username, group, userId }` | Insert row, or update B–E if the User ID (col F) exists |
| `{ action: "delete", userId }` | Delete row, renumber S/N |
| `{ action: "sync", members: [{ userId, name, group }] }` | Rewrite all rows; keeps C, D, G for existing IDs |

Returns `{ success: true }` or `{ success: false, error }`. The Worker logs failures as `Apps Script rejected:`.

Columns: A S/N · B Name · C Telegram Display Name · D Telegram Username · E Ministry Group · F User ID (text) · G Date Joined (date).

After editing Code.gs: Deploy → Manage deployments → Edit → **New version**.

## Error Handling

`handleRequest` wraps `handleUpdate` in try/catch and always returns 200 `OK`, so a failing update is logged (`Update failed:`) instead of being retried forever by Telegram. Never fire-and-forget `fetch` calls — un-awaited work is cancelled when the Worker returns.

## Events Model

- `events` is one JSON array in KV, order = order added. Admin-only writes, so no locking needed.
- Event ids are `"e" + Date.now().toString(36)` + 3 random chars — short so `mm_{id}_{memberId}` fits in 64 bytes, and unique even if two are created in the same millisecond.
- `location` is optional free text; `eventLine()` adds a `📍` line only when it's set.
- `when` is free text (no parsing) — events are never auto-expired; admins delete them.
- `getEvents()` migrates the old single-event keys on first run (`event_*` → first event, old `rsvp_{userId}` deleted).
- Add presets by editing `PRESET_EVENTS` at the top of `multi_index.js`.

## Rolling Back

Set `"main": "src/simple_index.js"` in `wrangler.jsonc` and deploy. Note the old version reads `event_*` / `rsvp_{userId}` keys, which the new version deleted — the admin would need to set the event again.

## Testing Without Telegram

The flows were checked with a small Node harness that fakes KV (`Map`) and `fetch`, posts webhook updates to `default.fetch`, and asserts on the edited message text/buttons and KV contents. Worth recreating as `test/` if the bot keeps growing.
