# Changelog
### SP Navigators Attendance Bot

---

## v3.0 — Interactive Version (simple_index.js)
_August 2026_

### New
- Single persistent message UI — only ONE message in chat, always edited
- Full button-based navigation — no slash commands needed
- Sensitive input (passwords, invite codes, names) deleted from chat immediately
- Screen builder pattern — each view is a self-contained function
- `input_pending` system — tracks what text input bot is waiting for
- `main_msg_{userId}` KV key — tracks the persistent message ID per user
- `reg_pending` with TTL expiry — registration data auto-clears after 10 min
- `input_pending` with TTL expiry — input prompts auto-clear after 5 min
- Week Mode screen — Normal / Stand Down / Holiday toggle
- Event Settings screen — all event controls in one place
- Members screen — admin view of all registered members

### Changed
- Registration flow now: invite code → name → group picker (all in one message)
- Passwords no longer visible in chat (deleted instantly)
- Home screen shows different buttons per role (member/leader/admin)

---

## v2.0 — Full Featured Version (index.js)
_August 2026_

### New
- Ministry group selection during registration (Refresher/Rescuer/Repairer/Rebuilder/Recharger)
- Google Sheets integration via Apps Script
- Admin notification on new member registration
- Week modes: Normal / Standdown / Holiday
- `/members` command — admin view of all members
- `/myid` command — members can find their Telegram ID
- Telegram IDs shown in `/list` for leaders
- Auto-approve bot creator (Jarrod) without invite code
- `ADMIN_NAME` environment variable for admin display name

### Fixed
- Password handler now returns early (no double-fire bug)
- `/register` allowed on weekends
- Unapproved `/start` missing message text bug
- Group picker message unclosed markdown bug

---

## v1.0 — Simple Version (worker.js)
_August 2026_

### Initial Release
- `/register` with invite code
- `/rsvp` with Yes/No buttons
- `/status` — check RSVP
- `/myid` — get Telegram ID
- `/login` `/logout` — leader/admin roles
- `/list` with member IDs
- `/whatsapp` summary
- `/addmember` `/removemember` — non-Telegram members
- `/setname` `/setdate` `/settime` `/autodate` — admin event controls
- `/cancel` `/activate` `/clear` — admin event management
- Auto Friday date calculation
- Stranger blocking — invite code required

---

## Archive — Complex Version (archive_index.js)
_Earlier 2026_

- Multiple events system
- Group-based WhatsApp summary
- Event history (`/myevents`)
- `/assigngroup` `/listgroups`
- `/newevent` `/deleteevent` `/clearevent`
- `/approve` `/unapprove` manual user approval
- `/setinvite` — change invite code via bot command


---

## v3.1 — Manage Members + No Admin Telegram Notification
_August 2026_

### New
- Leaders can add non-Telegram members via **👥 Manage Members** button
- Leaders can mark attendance for non-Telegram members
- Leaders can remove non-Telegram members
- Non-Telegram members show with ✏️ tag in attendance list
- All Members screen now shows group alongside name for both Telegram and non-Telegram members
- Separate group picker (`addgrp_` prefix) for adding members vs registration (`group_` prefix)

### Changed
- Admin no longer receives Telegram notification on new registration — Google Sheet only
  - Keeps admin chat clean (single message principle)
  - Check Google Sheet for new registrations instead
- `notifyAdmin()` now only calls `appendToSheet()` — no `sendMessage()`
- Callback prefixes shortened to stay under Telegram's 64 char limit:
  - `mark_member_` → `mark_`
  - `set_attendance_coming_` → `setatt_c_`
  - `set_attendance_notcoming_` → `setatt_n_`
  - `remove_member_` → `del_`

### Fixed
- Missing `input_invite_code` callback handler added
- `add_member_pending` KV key now has 5min TTL expiry

---

## v3.2 — Google Sheet Sync + Security Fixes
_October 2026_

### New
- **📊 Sync Sheet** admin button — rebuilds the Google Sheet from the bot's data
- **Remove Member** now lists all members (Telegram + non-Telegram) and deletes their sheet row (S/N renumbered)
- Non-Telegram members added by leaders are written to the sheet
- `Code.gs` added to the repo — Apps Script with insert / update / delete / sync, `SHEET_SECRET` auth, LockService, real dates

### Changed
- New-member alert to the creator is back (reverses v3.1); the creator's main menu is re-sent below each alert so it stays the latest message
- Sheet writes are now awaited (previously fire-and-forget, so they were often cancelled)

### Fixed
- Creator picking a group saved the name as "Member" instead of the typed name
- `/setup` route publicly exposed `BOT_TOKEN` — removed (token rotated)
- An error in one update made Telegram retry it forever — now caught and logged
- `notifyAdmin()` was not awaited — alerts could be dropped

---

## v4.0 — Multiple Events (multi_index.js)
_October 2026_ — based on leader feedback. `simple_index.js` kept as the archived single-event version.

### New
- Several events open at once, all listed on the home screen with the member's status
- One-tap ✅ / ❌ RSVP per event from the home screen
- **🗓 Manage Events** (admin): add from presets (Weekly Nav+U, Prayer Walk, VTP) or custom name; per-event rename, date & time, cancel/reopen, clear RSVPs, delete
- Date & time entered in one message
- Random text typed when the bot isn't asking for anything is deleted automatically (chat stays at one message)
- Optional **📍 Location** per event — asked when adding (with Skip), editable from the event screen, shown on home, list and WhatsApp
- View List, WhatsApp summary and Mark Attendance work per event

### Removed
- Week Mode (replaced by just adding the events you need)
- Auto Date (This Friday)
- Separate RSVP / My Status screens (status is on the home screen)
- Global Clear RSVPs (now per event)
- "Deleted immediately" wording in prompts and guides

### Fixed
- Creating a "new event" only overwrote the single existing event

### Migration
- First run turns the old event into the first event; old RSVPs and `event_*` keys are cleared

