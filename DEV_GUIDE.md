# Developer Guide
### SP Navigators Attendance Bot — Technical Reference v2

---

## Project Structure

```
spnav-bot/
├── simple_index.js        ← Interactive button-based bot (current)
├── index.js               ← Command-based bot (backup)
├── archive_index.js       ← Old complex multi-event version
├── wrangler.toml          ← Cloudflare config
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
Cloudflare Worker (simple_index.js)
      ↓ reads/writes
Cloudflare KV (ATTENDANCE_KV)
      ↓ on registration
Google Apps Script → Google Sheets (background, no await)
```

---

## Code Structure

```
simple_index.js
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
│   ├── appendToSheet()        — Google Sheets (fire and forget)
│   └── notifyAdmin()          — calls appendToSheet only (no Telegram msg)
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
│   ├── buildRemoveMemberScreen()  — remove non-telegram member
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
| `addgrp_` | Group when adding member | `addgrp_refresher` |
| `mark_` | Open attendance for member | `mark_nontelegram:James` |
| `setatt_c_` | Set as coming | `setatt_c_nontelegram:James` |
| `setatt_n_` | Set as not coming | `setatt_n_nontelegram:James` |
| `del_` | Delete member | `del_nontelegram:James` |

> ⚠️ Telegram has a 64 character limit on callback_data. Prefixes are kept short intentionally.

---

## Non-Telegram Member Flow

```
Leader taps [➕ Add Member]
      ↓
promptInput → set input_pending = "add_member_name"
      ↓
Leader types name → deleted immediately
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
buildMarkAttendanceScreen — lists all nontelegram: members with status icons
      ↓
Leader taps member (mark_nontelegram:James)
      ↓
Shows Coming/Not Coming buttons
      ↓
setatt_c_ or setatt_n_ → saves rsvp_nontelegram:James
Returns to mark attendance screen
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
| `set_name` | Event Settings → Name | Event name update |
| `set_date` | Event Settings → Date | Event date update |
| `set_time` | Event Settings → Time | Event time update |
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
  rsvp_{userId}                    → "coming" | "notcoming"
  rsvp_nontelegram:{name}          → "coming" | "notcoming"

UI state:
  main_msg_{userId}                → "12345678" (message ID)
  input_pending_{userId}           → "invite_code" | "name" | ... (5min TTL)
  reg_pending_{userId}             → JSON string (10min TTL)
  add_member_pending_{userId}      → "James Wong" (5min TTL)

Event config:
  event_name                       → "Weekly Nav+U"
  event_date                       → "5 September 2026 (Fri)"
  event_time                       → "5:30pm"
  event_active                     → "false" (only when cancelled)
  event_mode                       → "normal" | "standdown" | "holiday"
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
npm run deploy          # Deploy to production
npx wrangler tail       # Watch live logs
npx wrangler dev --remote  # Local dev with real KV
npx wrangler login      # Re-authenticate
```

---

## Known Limitations

| Limitation | Detail |
|---|---|
| 64 char callback_data limit | Telegram enforced — keep prefixes short |
| 4096 char message limit | Large member lists may truncate |
| No message delete after 48h | Telegram API restriction |
| input_pending TTL | Expires after 5 min if user doesn't type |
| Non-telegram member IDs | Must not contain special chars that break KV keys |
