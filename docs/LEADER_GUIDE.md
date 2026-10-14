# Leader Guide
### SP Navigators Attendance Bot (@spnav_bot)

---

## Login as Leader

1. Tap **👤 My Profile** → **🔐 Leader/Admin Login**
2. Tap **🔐 Login as Leader**
3. Type the leader password
4. Home screen reloads with leader buttons

---

## Leader Home Screen

```
☀️ Good afternoon, Sarah!

📖 Weekly Nav+U — Fri 17 Oct, 5:30pm
✅ You're COMING

🙏 Prayer Walk — Sat 18 Oct, 9am
📍 SP Chapel
❓ Not RSVP'd yet

Tap ✅ coming or ❌ not coming:

[👉 ✅ Weekly Nav+U] [❌ Weekly Nav+U]
[✅ Prayer Walk]    [❌ Prayer Walk]
[👤 My Profile]
[📋 View List]      [📱 WhatsApp]
[👥 Manage Members]
[🚪 Logout]
```

👉 on a button marks the option you already picked.

---

## View Attendance List

Tap **📋 View List** — one section per event, showing **your team only** (Restorer leaders see brothers, Hesed leaders see sisters):

```
📋 Attendance List

📖 Weekly Nav+U — Fri 17 Oct, 5:30pm
✅ Coming (3):
• John Tan (709711203)
• Mary Lim (123456789)
• James Wong
❌ Not Coming (1):
• Ben Ng (987654321)

🙏 Prayer Walk — Sat 18 Oct, 9am
📍 SP Chapel
✅ Coming (1):
• Mary Lim (123456789)
❌ Not Coming (0):
• None
```

Members without Telegram show without an ID.

---

## WhatsApp Summary

Tap **📱 WhatsApp**. Leaders see their own team; admins pick **Restorer** or **Hesed** first.

Each open event gets its own block — **tap the block to copy it**, then paste into WhatsApp (the *bold* and _italic_ come through properly).

### Formats
Tap **🎨 Format** to choose — each team keeps its own choice:

| Format | What it looks like |
|---|---|
| **By group** (default) | Who's coming under each ministry group, each ending with a blank number so others can add themselves. Teams with no groups get one list. |
| **Coming / Not coming** | Two lists with counts |
| **Simple list** | One numbered list of who's coming + a blank number |
| **Custom template** | Your own layout (see below) |

By group example (Restorer):
```
📖 *《Restorer Weekly Nav+U Attendance》*
- Fri 17 Oct, 5:30pm
- Colours @ Library

_Refresher_
1. Abner
2.

_Rescuer_
1. Caleb
2. Lucas
3.
...

✝️🏃🏻‍♂️💨
```

- Groups follow the team's group order; names are A–Z
- **✏️ Edit Footer** changes the last line for your team (type `-` for none). Restorer starts with ✝️🏃🏻‍♂️💨, Hesed with none.

### Custom template
Choose **Custom template**, then **✏️ Edit Template** and type the whole message. These words in curly brackets are filled in:

| Placeholder | Becomes |
|---|---|
| `{emoji}` | The event's emoji (📖 🙏 🏕️ …) |
| `{team}` | Restorer / Hesed |
| `{event}` | Event name |
| `{date}` | Date & time |
| `{location}` | Location |
| `{groups}` | Who's coming, by ministry group (same as By group) |
| `{coming}` / `{notcoming}` | Numbered lists |
| `{coming_count}` / `{notcoming_count}` | Numbers |

Example:
```
*《{team} {event}》*
- {date}
- {location}

Coming ({coming_count}):
{coming}

Not coming:
{notcoming}
```
Lines left empty (e.g. no location) are dropped automatically.

---

## Manage Members (Non-Telegram)

Tap **👥 Manage Members** to add/remove members and mark attendance for members without Telegram:

```
👥 Manage Members

[➕ Add Member]
[📋 Mark Attendance]
[🗑️ Remove Member]
[🔙 Back]
```

### Add a Member
1. Tap **➕ Add Member**
2. Type their full name
3. Select their ministry group
4. Done — they appear in the attendance list and the Google Sheet

### Mark Their Attendance
1. Tap **📋 Mark Attendance**
2. Pick the event (skipped if there's only one)
3. Tap the member's name
4. Tap **✅ Coming** or **❌ Not Coming**
5. Updates immediately

### Remove a Member
1. Tap **🗑️ Remove Member**
2. Tap the member's name — the list shows everyone (non-Telegram members are marked "(no Telegram)")
3. They are removed from the bot **and** their Google Sheet row is deleted

> ⚠️ This can't be undone. A removed Telegram member has to register again with the invite code to come back.

---

## Weekly Workflow

**Every Monday:**
- Remind members to RSVP

**During the week:**
- Check **📋 View List** to track responses
- Use **📋 Mark Attendance** for non-Telegram members

**Thursday/Friday:**
- Tap **📱 WhatsApp** → copy to group chat

---

## If Members Type in the Chat

Typing doesn't break anything — the bot deletes any message it didn't ask for. If a member's message "disappears", remind them to use the buttons.

---

## Logout

Tap **🚪 Logout** when done.

---

## Members Fixing Their Own Details

Members can sort these out themselves in **👤 My Profile** — no leader needed:
- **✏️ Update Name**
- **👥 Change Group** — pick a ministry group, or **Not sure** for now and change it later

The Google Sheet updates automatically when they change their group.

---

## Teams

You only see and manage members of **your own team** — attendance list, WhatsApp, marking attendance, adding and removing members. Members you add without Telegram go into your team automatically. Admins can see both teams.

---

## Emojis at a Glance

| Emoji | Meaning |
|---|---|
| 🌅 / ☀️ / 🌙 | Good morning / afternoon / evening (Singapore time) |
| 📖 | Weekly Nav+U |
| 🙏 | Prayer Walk |
| 🏕️ | VTP |
| 📅 | Other events (admins can pick a different one with **Change Emoji** on the event) |
| ⛔ | Event cancelled |
| ✅ / ❌ / ❓ | Coming / Not coming / Not answered yet |
| 👉 | The answer you already picked |
| 👨 / 👩 / 👥 | Restorer (brothers) / Hesed (sisters) / Both teams |
| 🎉 🙌 😢 | Registered / RSVP'd coming / RSVP'd not coming |
