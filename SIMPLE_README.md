# SP Navigators Attendance Bot — Interactive Version
### simple_index.js v2

A fully button-based interactive Telegram bot. Only ONE persistent message exists in chat — all navigation happens by editing that single message.

---

## What's New in v2

- Leaders can add non-Telegram members and mark their attendance manually
- Admin receives NO Telegram notification on registration — Google Sheet only (keeps admin chat clean)
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

---

## Screens

| Screen | Who | How to reach |
|---|---|---|
| Welcome | Strangers | First /start |
| Register | Strangers | Tap "I have invite code" |
| Home | All members | After registration / Back |
| RSVP | Members | RSVP button |
| My Status | Members | My Status button |
| My Profile | Members | My Profile button |
| Login | Members | Login button |
| View List | Leaders + Admin | View List button |
| WhatsApp | Leaders + Admin | WhatsApp button |
| Manage Members | Leaders + Admin | Manage Members button |
| Mark Attendance | Leaders + Admin | Inside Manage Members |
| Remove Member | Leaders + Admin | Inside Manage Members |
| Event Settings | Admin | Event Settings button |
| Week Mode | Admin | Week Mode button |
| All Members | Admin | All Members button |

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
| `APPS_SCRIPT_URL` | Optional | Google Apps Script URL |

---

## KV Keys

| Key | Value | Description |
|---|---|---|
| `name_{userId}` | String | Registered name |
| `approved_{userId}` | `"true"` | User approved |
| `role_{userId}` | `"member/leader/admin"` | Role |
| `group_{userId}` | String | Ministry group |
| `rsvp_{userId}` | `"coming/notcoming"` | RSVP status |
| `main_msg_{userId}` | Number | Persistent message ID |
| `input_pending_{userId}` | String | Awaiting text input (5min TTL) |
| `reg_pending_{userId}` | JSON | Temp registration data (10min TTL) |
| `add_member_pending_{userId}` | String | Temp name for non-tele member (5min TTL) |
| `event_name` | String | Event name |
| `event_date` | String | Event date |
| `event_time` | String | Event time |
| `event_active` | `"false"` | Cancelled flag |
| `event_mode` | `"normal/standdown/holiday"` | Week mode |

---

## Switch Versions

Edit `wrangler.toml`:
```toml
main = "simple_index.js"   # interactive version
main = "index.js"          # command version
```
Then `npm run deploy`.
