# Admin Guide
### SP Navigators Attendance Bot (@spnav_bot)

---

## Login as Admin

1. Tap **🔐 Leader/Admin Login**
2. Tap **🔐 Login as Admin**
3. Type the admin password — deleted immediately
4. Home screen reloads with all admin buttons

> ℹ️ Jarrod (bot creator) is auto-approved and auto-named — no invite code needed. Just tap /start.

---

## Admin Home Screen

```
🙏 Welcome, Jarrod!

📅 Weekly Nav+U on 5 Sep 2026 (Fri) at 5:30pm

[📋 RSVP]             [📊 My Status]
[👤 My Profile]
[📋 View List]         [📱 WhatsApp]
[👥 Manage Members]
[⚙️ Event Settings]    [🔄 Week Mode]
[👥 All Members]       [🗑️ Clear RSVPs]
[🚪 Logout]
```

---

## Event Settings

Tap **⚙️ Event Settings**:

```
⚙️ Event Settings

📅 Current: Weekly Nav+U on 5 Sep 2026 (Fri) at 5:30pm

[✏️ Name]  [📅 Date]  [⏰ Time]
[🗓 Auto Date (This Friday)]
[❌ Cancel Event]  [✅ Activate]
[🔙 Back]
```

| Button | What it does |
|---|---|
| ✏️ Name | Type new event name |
| 📅 Date | Type new date e.g. `5 September 2026 (Fri)` |
| ⏰ Time | Type new time e.g. `5:30pm` |
| 🗓 Auto Date | Resets to this coming Friday automatically |
| ❌ Cancel Event | Members see cancellation notice on RSVP |
| ✅ Activate | Reactivates a cancelled event |

---

## Week Mode

Tap **🔄 Week Mode**:

```
🔄 Week Mode

Current: 📖 Normal Week

[📖 Normal Week (Nav+U)]
[🙏 CCA Stand Down (Prayer Walk)]
[🏖️ Holiday / VTP Break]
[🔙 Back]
```

| Mode | Members see | RSVP? |
|---|---|---|
| Normal Week | Weekly Nav+U | ✅ Yes |
| CCA Stand Down | Prayer Walk | ✅ Yes |
| Holiday / VTP Break | No activity | ❌ No |

---

## Clear RSVPs

Tap **🗑️ Clear RSVPs** on home screen to reset all RSVP data for a new week.

> ⚠️ Cannot be undone.

---

## All Members

Tap **👥 All Members** to see everyone registered including their group and user ID.

---

## New Member Registrations

When someone registers:
- ✅ Saved to Google Sheet automatically
- ❌ No Telegram notification to admin (keeps your chat clean — one message only)

Check your Google Sheet to see new registrations.

---

## Weekly Admin Checklist

**Every Monday:**
- [ ] Tap **🗑️ Clear RSVPs**
- [ ] Tap **⚙️ Event Settings** → **🗓 Auto Date** if needed
- [ ] Check week mode is correct

**CCA Stand Down week:**
- [ ] Tap **🔄 Week Mode** → **🙏 CCA Stand Down**

**Holiday / VTP week:**
- [ ] Tap **🔄 Week Mode** → **🏖️ Holiday / VTP Break**

**Back to normal:**
- [ ] Tap **🔄 Week Mode** → **📖 Normal Week**

---

## Changing Passwords / Invite Code

Go to Cloudflare Dashboard → Workers → Settings → Variables:

| Variable | What |
|---|---|
| `ADMIN_PASSWORD` | Admin login password |
| `LEADER_PASSWORD` | Leader login password |
| `INVITE_CODE` | Member invite code |

After changing → run `npm run deploy`.

---

## Emergency — Bot Not Responding

1. Visit `https://spnav-bot.omnivorefan.workers.dev` — shows "running"?
2. Visit `/setup` to reset webhook
3. Run `npx wrangler tail` for live error logs

See `TROUBLESHOOT.md` for full guide.
