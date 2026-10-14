# Admin Guide
### SP Navigators Attendance Bot (@spnav_bot)

---

## Login as Admin

1. Tap **🔐 Leader/Admin Login**
2. Tap **🔐 Login as Admin**
3. Type the admin password
4. Home screen reloads with all admin buttons

> ℹ️ The bot creator (`ADMIN_USER_ID`) is auto-approved — no invite code needed. Tap /start, type your name and pick a group.

---

## Admin Home Screen

```
🙏 Welcome, Sarah!

📅 Weekly Nav+U — Fri 17 Oct, 5:30pm
✅ You're COMING

📅 Prayer Walk — Sat 18 Oct, 9am
📍 SP Chapel
❓ Not RSVP'd yet

Tap ✅ coming or ❌ not coming:

[✅ Weekly Nav+U]   [❌ Weekly Nav+U]
[✅ Prayer Walk]    [❌ Prayer Walk]
[👤 My Profile]
[📋 View List]       [📱 WhatsApp]
[👥 Manage Members]
[🗓 Manage Events]   [👥 Members]
[📊 Sync Sheet]
[🚪 Logout]
```

Every open event shows on the home screen with the member's status — no separate RSVP or status screen.

---

## Manage Events

Tap **🗓 Manage Events** to see all events. Several can be open at the same time.

### Add an event
1. Tap **➕ Add Event**
2. Pick a regular event — **Weekly Nav+U**, **Prayer Walk**, **VTP** — or **✏️ Custom name** and type one
3. Type the date & time in one message, e.g. `Fri 17 Oct, 5:30pm`
4. Type the location, e.g. `SP Chapel` — or tap **⏭ Skip**
5. Done — it appears on everyone's home screen straight away

### Edit an event
Tap the event in the list:

```
🗓 Weekly Nav+U — Fri 17 Oct, 5:30pm
📍 SP Chapel

Status: ✅ Open for RSVP
RSVPs: ✅ 12  ❌ 3

[✏️ Rename]        [🕐 Date & Time]
[📍 Location]
[❌ Cancel Event]
[🧹 Clear RSVPs]   [🗑️ Delete Event]
[🔙 Back]
```

| Button | What it does |
|---|---|
| ✏️ Rename | Type a new name |
| 🕐 Date & Time | Type the new date & time in one message |
| 📍 Location | Type the location (type `-` to remove it) |
| ❌ Cancel Event | Members see "Cancelled", RSVP buttons disappear (becomes ✅ Reopen Event) |
| 🧹 Clear RSVPs | Reset RSVPs for this event only — reuse it for next week |
| 🗑️ Delete Event | Remove the event and its RSVPs |

> ⚠️ Clear and Delete can't be undone. Events are **not** removed automatically — delete them after they're over.

### Reusing a weekly event
For Weekly Nav+U you can keep one event: after Friday, tap **🧹 Clear RSVPs** and **🕐 Date & Time** for next week. Or delete it and add a fresh one — both work.

---

## All Members

Tap **👥 All Members** to see everyone registered including their group and user ID.

---

## New Member Registrations

When someone registers:
- ✅ Saved to Google Sheet automatically
- 🔔 The bot creator (`ADMIN_USER_ID`) gets a **"New member registered"** alert (name, group, username, user ID)
- The creator's main menu is re-sent **below** the alert, so the menu is always the latest message

Only the creator gets alerts — other admins and leaders don't. Old alerts can be deleted anytime.

---

## Google Sheet

The sheet stays in sync automatically when you use the bot:

| Action in bot | Google Sheet |
|---|---|
| Member registers | Row added (or updated if they register again) |
| Leader adds non-Telegram member | Row added (Display Name / Username = `-`) |
| Remove Member | Row deleted, S/N renumbered |
| **📊 Sync Sheet** | Whole sheet rebuilt from the bot's data |

### 📊 Sync Sheet
Tap after anything changed outside the bot (e.g. KV keys deleted in the Cloudflare dashboard, rows edited by hand).
- Adds missing members, deletes rows of people no longer in the bot, updates names/groups
- Keeps Display Name, Username and Date Joined for existing rows
- Renumbers S/N, oldest member first

> ⚠️ Deleting keys directly in Cloudflare KV does **not** update the sheet. Remove people through the bot, or tap Sync Sheet afterwards.

### Sheet setup (one-time)
- Apps Script code is `Code.gs` in this repo — paste it into the sheet's Apps Script editor
- `SHEET_NAME` at the top must match the tab name (currently `Database`)
- Script Properties → `SHEET_SECRET` must equal the Worker's `SHEET_SECRET`
- Deploy as Web app: **Execute as: Me**, **Who has access: Anyone** (the secret blocks outsiders)
- After any change: **Deploy → Manage deployments → Edit → New version → Deploy** (URL stays the same)
- Old deployments can't be deleted, only archived — that's fine

---

## Weekly Admin Checklist

**After each event:**
- [ ] **🗓 Manage Events** → tap the event → **🗑️ Delete Event** (or **🧹 Clear RSVPs** + **🕐 Date & Time** to reuse it)

**Planning ahead:**
- [ ] **➕ Add Event** for each upcoming activity (Nav+U, Prayer Walk, VTP, camps…)
- [ ] Cancelled? Tap the event → **❌ Cancel Event**
- [ ] No activity this week? Just don't add an event — members see "No upcoming events"

**Now and then:**
- [ ] Remove anyone who has left (**👥 Manage Members → 🗑️ Remove Member**)

---

## Changing Passwords / Invite Code

Go to Cloudflare Dashboard → Workers → Settings → Variables:

| Variable | What |
|---|---|
| `ADMIN_PASSWORD` | Admin login password |
| `LEADER_PASSWORD` | Leader login password |
| `INVITE_CODE` | Member invite code |
| `SHEET_SECRET` | Must match Apps Script's `SHEET_SECRET` |

Or from the terminal: `npx wrangler secret put ADMIN_PASSWORD` (applies immediately, no deploy needed).

---

## Emergency — Bot Not Responding

1. Visit `https://spnav-bot.omnivorefan.workers.dev` — shows "running"?
2. Run `npx wrangler tail`, send `/start` — no `POST .../webhook/...` line means the webhook is broken
3. Reset the webhook (PowerShell — copy the token from @BotFather first, then run):
   ```powershell
   $t = (Get-Clipboard).Trim()
   Invoke-RestMethod "https://api.telegram.org/bot$t/getMe"
   Invoke-RestMethod "https://api.telegram.org/bot$t/setWebhook?url=https://spnav-bot.omnivorefan.workers.dev/webhook/$t&drop_pending_updates=true"
   Invoke-RestMethod "https://api.telegram.org/bot$t/getWebhookInfo" | Select-Object -ExpandProperty result
   ```
   `getMe` 404 = wrong token. In PowerShell, Ctrl+V in a prompt types `^V` — use `Get-Clipboard` or right-click.

### Rotating the bot token (if it leaks)
1. @BotFather → `/revoke` → pick the bot → copy the new token
2. `$t = (Get-Clipboard).Trim()` then `$t | npx wrangler secret put BOT_TOKEN`
3. Run the `setWebhook` line above
4. Never paste the token in chats, screenshots or files that go on GitHub

### Sheet not updating
Run `npx wrangler tail` and look for `Apps Script rejected`:
- `unauthorized` → `SHEET_SECRET` differs between Worker and Script Properties
- `sheet not found` → `SHEET_NAME` in Code.gs doesn't match the tab name
- no line at all → `APPS_SCRIPT_URL` not set
