// ============================================
// SP NAVIGATORS ATTENDANCE BOT
// src/index.js — Interactive Single-Message Version, multiple events (v4)
// Older versions live in src/archive/ (simple_index.js = single-event v3)
// ============================================
//
// HOW THIS VERSION WORKS:
//   - Only ONE persistent message in chat (the "main screen")
//   - Everything is buttons — no slash commands needed
//   - Main message gets EDITED when user taps buttons
//   - Several events can be open at once; each shows on the home screen with its own RSVP
//   - Typed text (invite codes, names, passwords) is removed from chat after reading
//   - Text typed when the bot isn't asking for anything is deleted and ignored
//
// Cloudflare Environment Variables needed:
//   BOT_TOKEN       — Telegram bot token
//   ADMIN_USER_ID   — Your Telegram user ID (number) — gets new-member alerts
//   ADMIN_NAME      — Your display name (optional, falls back to Telegram name)
//   ADMIN_PASSWORD  — Admin login password
//   LEADER_PASSWORD — Leader login password
//   INVITE_CODE     — Invite code for new members
//   APPS_SCRIPT_URL — Google Apps Script URL for Google Sheets
//   SHEET_SECRET    — Shared secret checked by the Apps Script
//
// KV Namespace binding: ATTENDANCE_KV
//
// KV Keys used:
//   name_{userId}             — Member's registered name
//   approved_{userId}         — Whether user is approved ("true")
//   role_{userId}             — User role ("member", "leader", "admin")
//   group_{userId}            — Ministry group name ("-" if the team has no groups)
//   team_{userId}             — "restorer" (brothers) or "hesed" (sisters); missing = restorer
//   main_msg_{userId}         — The persistent message ID to edit
//   input_pending_{userId}    — What text input we're waiting for
//   reg_pending_{userId}      — Temporary registration data while waiting for group selection (JSON)
//   events                    — JSON array of events: [{ id, name, when, location, team, active }]
//                               team = "both" | "restorer" | "hesed"
//   groups_{team}             — JSON array of that team's ministry group names (admin-editable)
//   wa_format_{team}          — WhatsApp layout: "groups" | "split" | "simple" | "custom"
//   wa_template_{team}        — Custom WhatsApp template (with {placeholders})
//   wa_footer_{team}          — Last line of the WhatsApp summary
//   invite_code               — Invite code set by an admin (overrides INVITE_CODE)
//   rsvp_{eventId}_{userId}   — RSVP status for one event ("coming", "notcoming")
//   new_event_pending_{userId}— Event being added: name, then JSON { name, when } while asking location
// ============================================


// Preset event names offered when adding an event
const PRESET_EVENTS = ["Weekly Nav+U", "Prayer Walk", "VTP"];

// Teams — brothers and sisters use the same bot
const TEAMS = [
    ["restorer", "Restorer"],
    ["hesed", "Hesed"]
];
const TEAM_EMOJI = { restorer: "👨", hesed: "👩", both: "👥" };

// Emoji per event type; admins can pick another for any event
const EVENT_EMOJI_RULES = [
    [/nav\s*\+?\s*u/i, "📖"],
    [/prayer/i, "🙏"],
    [/vtp|vacation/i, "🏕️"]
];
const EVENT_EMOJI_CHOICES = ["📅", "📖", "🙏", "🏕️", "🎉", "⛪", "🍽️", "🎶", "⚽", "🎓", "✝️", "🌱"];

function eventEmoji(event) {
    if (event.emoji) return event.emoji;
    const rule = EVENT_EMOJI_RULES.find(([re]) => re.test(event.name || ""));
    return rule ? rule[1] : "📅";
}

// Time-of-day greeting (Singapore time)
function greeting() {
    const hour = (new Date().getUTCHours() + 8) % 24;
    return hour < 12 ? "🌅 Good morning" : hour < 18 ? "☀️ Good afternoon" : "🌙 Good evening";
}

// Starting ministry groups per team (admins can edit them in the bot)
const DEFAULT_GROUPS = {
    restorer: ["Refresher", "Rescuer", "Repairer", "Rebuilder", "Recharger"],
    hesed: []
};

const NOT_SURE = "Not sure";

function teamLabel(team) {
    const found = TEAMS.find(([k]) => k === team);
    return found ? found[1] : "Both teams";
}

// Team name with its emoji, for showing in the bot (sheet/WhatsApp use teamLabel)
function teamTag(team) {
    return `${TEAM_EMOJI[team] || TEAM_EMOJI.both} ${teamLabel(team)}`;
}

async function getTeam(userId, env) {
    return await env.ATTENDANCE_KV.get(`team_${userId}`) || "restorer";
}

async function getGroups(team, env) {
    const raw = await env.ATTENDANCE_KV.get(`groups_${team}`);
    return raw ? JSON.parse(raw) : (DEFAULT_GROUPS[team] || []);
}

async function saveGroups(team, groups, env) {
    await env.ATTENDANCE_KV.put(`groups_${team}`, JSON.stringify(groups));
}

// One button per group (callback = prefix + index), plus "Not sure"
async function groupButtons(team, prefix, env) {
    const groups = await getGroups(team, env);
    const buttons = groups.map((g, i) => [{ text: g, callback_data: `${prefix}${i}` }]);
    buttons.push([{ text: NOT_SURE, callback_data: `${prefix}ns` }]);
    return buttons;
}

// Turn the index from a group button back into the group name
async function groupFromButton(team, suffix, env) {
    if (suffix === "ns") return NOT_SURE;
    return (await getGroups(team, env))[parseInt(suffix)] || NOT_SURE;
}

// Who can see an event: "both" (default) or one team
function eventVisibleTo(event, team) {
    return !event.team || event.team === "both" || event.team === team;
}

// Team a leader/admin works with: leaders = own team, admins = all (null)
async function scopeTeam(userId, env) {
    return (await isAdmin(userId, env)) ? null : await getTeam(userId, env);
}

// Invite code: admins can change it in the bot (KV); the INVITE_CODE secret is the starting value
async function getInviteCode(env) {
    return await env.ATTENDANCE_KV.get("invite_code") || env.INVITE_CODE;
}

// WhatsApp summary layouts leaders can pick from
const WA_FORMATS = [
    ["groups", "By group"],
    ["split", "Coming / Not coming"],
    ["simple", "Simple list"],
    ["custom", "Custom template"]
];

// Starting custom template — placeholders are filled in by the bot
const DEFAULT_WA_TEMPLATE = "{emoji} *《{team} {event} Attendance》*\n- {date}\n- {location}\n\n{groups}\n\n✝️🏃🏻‍♂️💨";

async function getWaFooter(team, env) {
    const stored = await env.ATTENDANCE_KV.get(`wa_footer_${team}`);
    if (stored !== null) return stored;
    if (team === "restorer") {
        const legacy = await env.ATTENDANCE_KV.get("wa_footer"); // from before teams existed
        return legacy === null ? "✝️🏃🏻‍♂️💨" : legacy;
    }
    return "";
}


// ============================================
// TELEGRAM API HELPERS
// ============================================

// Send a brand new message (returns the message object so we can save its ID)
async function sendMessage(chatId, text, token) {
    return await telegramCall("sendMessage", { chat_id: chatId, text }, token);
}

// Send a new message WITH inline keyboard buttons (returns message object)
async function sendKeyboard(chatId, text, keyboard, token) {
    return await telegramCall("sendMessage", { chat_id: chatId, text, reply_markup: keyboard }, token);
}

// Telegram "Markdown" treats _ * ` [ as formatting. Names like "wei_liang" would break a
// message, so user-typed text is escaped before being put into a message:
//   md(x)  — outside bold/italic
//   mdb(x) — inside *bold* (Telegram doesn't allow escapes inside an entity, so close/reopen it)
function md(value) {
    return String(value).replace(/([_*`\[])/g, "\\$1");
}
function mdb(value) {
    return String(value).replace(/([_*`\[])/g, "*\\$1*");
}

// Send/edit with Markdown; if Telegram still can't parse it, resend as plain text so the user always gets the screen
async function telegramCall(method, payload, token) {
    const call = body => fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => ({ ok: false }));
    let res = await call({ ...payload, parse_mode: "Markdown" });
    if (res && res.ok === false && /parse entities/i.test(res.description || "")) {
        console.error("Markdown parse failed, sending plain:", res.description);
        res = await call(payload);
    }
    return res;
}

// Edit the existing persistent message (text only, no keyboard)
async function editMessage(chatId, messageId, text, token) {
    await telegramCall("editMessageText", { chat_id: chatId, message_id: messageId, text }, token);
}

// Edit the existing persistent message WITH inline keyboard buttons
async function editMessageWithKeyboard(chatId, messageId, text, keyboard, token) {
    await telegramCall("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard }, token);
}

// Delete a message from chat (used to remove sensitive text like passwords)
async function deleteMessage(chatId, messageId, token) {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId
        })
    });
}

// Answer a callback query (removes the loading spinner on button tap)
async function answerCallback(callbackId, token) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackId })
    });
}


// ============================================
// PERSISTENT MESSAGE HELPERS
// Saves/retrieves the ONE main message ID per user
// ============================================

// Save the main message ID to KV so we can edit it later
async function saveMainMessageId(userId, messageId, env) {
    await env.ATTENDANCE_KV.put(`main_msg_${userId}`, messageId.toString());
}

// Get the saved main message ID
async function getMainMessageId(userId, env) {
    const id = await env.ATTENDANCE_KV.get(`main_msg_${userId}`);
    return id ? parseInt(id) : null;
}

// The core function — edits the persistent main message with new content + buttons
// If no main message exists yet, sends a new one and saves its ID
async function updateMainScreen(userId, chatId, text, keyboard, env) {
    const messageId = await getMainMessageId(userId, env);
    if (messageId) {
        // Edit existing message
        await editMessageWithKeyboard(chatId, messageId, text, keyboard, env.BOT_TOKEN);
    } else {
        // No message yet — send a new one and save its ID
        const res = await sendKeyboard(chatId, text, keyboard, env.BOT_TOKEN);
        if (res.ok && res.result) {
            await saveMainMessageId(userId, res.result.message_id, env);
        }
    }
}


// ============================================
// USER HELPERS
// ============================================

// Get registered name — falls back to "Member" if not set
async function getName(userId, env) {
    const name = await env.ATTENDANCE_KV.get(`name_${userId}`);
    return name || "Member";
}

// Check if user has been approved (registered with invite code)
async function isApproved(userId, env) {
    const val = await env.ATTENDANCE_KV.get(`approved_${userId}`);
    return val === "true";
}

// Get user role: "member", "leader", or "admin"
async function getRole(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role || "member";
}

// Check if user is leader or admin
async function isLeader(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role === "leader" || role === "admin";
}

// Check if user is admin only
async function isAdmin(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role === "admin";
}


// ============================================
// EVENT HELPERS
// ============================================

// All events, in the order they were added
async function getEvents(env) {
    const raw = await env.ATTENDANCE_KV.get("events");
    if (raw) return JSON.parse(raw);

    // First run after upgrading from the single-event version:
    // turn the old event into the first entry and drop the old-style RSVP keys
    const oldName = await env.ATTENDANCE_KV.get("event_name") || "Weekly Nav+U";
    const oldDate = await env.ATTENDANCE_KV.get("event_date");
    const oldTime = await env.ATTENDANCE_KV.get("event_time") || "5:30pm";
    const events = oldDate ? [{ id: newEventId(), name: oldName, when: `${oldDate}, ${oldTime}`, active: true }] : [];
    const oldRsvps = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
    for (const key of oldRsvps.keys) {
        if (!key.name.slice(5).includes("_")) await env.ATTENDANCE_KV.delete(key.name);
    }
    for (const k of ["event_name", "event_date", "event_time", "event_active", "event_mode"]) {
        await env.ATTENDANCE_KV.delete(k);
    }
    await saveEvents(events, env);
    return events;
}

async function saveEvents(events, env) {
    await env.ATTENDANCE_KV.put("events", JSON.stringify(events));
}

async function getEvent(eventId, env) {
    return (await getEvents(env)).find(e => e.id === eventId) || null;
}

// Short id so callback_data stays under Telegram's 64-byte limit
function newEventId() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function eventLine(event) {
    return `*${mdb(event.name)}*${event.when ? ` — ${md(event.when)}` : ""}`
        + (event.location ? `\n📍 ${md(event.location)}` : "")
        + (event.team && event.team !== "both" ? `\n${teamTag(event.team)} only` : "");
}

// Create the event the admin has been typing (name + date & time saved in new_event_pending)
async function createPendingEvent(userId, location, env) {
    const raw = await env.ATTENDANCE_KV.get(`new_event_pending_${userId}`);
    await env.ATTENDANCE_KV.delete(`new_event_pending_${userId}`);
    if (!raw || !raw.startsWith("{")) return `❌ Expired. Please add the event again.`;
    const { name, when, team } = JSON.parse(raw);
    if (!when) return `❌ Expired. Please add the event again.`;
    const events = await getEvents(env);
    const event = { id: newEventId(), name, when, location, team: team || "both", active: true };
    events.push(event);
    await saveEvents(events, env);
    return `✅ Added ${eventLine(event)}`;
}

// "Who is this event for?" picker (callback = prefix + team)
function audienceButtons(prefix) {
    return [
        [{ text: teamTag("both"), callback_data: `${prefix}both` }],
        ...TEAMS.map(([key]) => [{ text: `${teamTag(key)} only`, callback_data: `${prefix}${key}` }])
    ];
}

// Short label for buttons
function shortName(name) {
    return name.length > 16 ? name.slice(0, 15) + "…" : name;
}

async function getRsvp(eventId, userId, env) {
    return await env.ATTENDANCE_KV.get(`rsvp_${eventId}_${userId}`);
}

// Coming / not coming names for one event
// Coming / not coming names for one event (team = null for everyone)
async function getEventAttendance(eventId, env, withIds, team) {
    const list = await env.ATTENDANCE_KV.list({ prefix: `rsvp_${eventId}_` });
    const coming = [], notcoming = [];
    for (const key of list.keys) {
        const status = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.slice(`rsvp_${eventId}_`.length);
        const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
        if (!memberName) continue; // member was removed
        if (team && await getTeam(memberId, env) !== team) continue;
        const label = withIds && !memberId.startsWith("nontelegram:") ? `${md(memberName)} (${memberId})` : md(memberName);
        if (status === "coming") coming.push(label);
        else if (status === "notcoming") notcoming.push(label);
    }
    return { coming, notcoming };
}

async function deleteKeysWithPrefix(prefix, env) {
    const list = await env.ATTENDANCE_KV.list({ prefix });
    for (const key of list.keys) await env.ATTENDANCE_KV.delete(key.name);
}


// ============================================
// GOOGLE SHEETS VIA APPS SCRIPT
// Sends member data to Google Sheet when they register
// Fails silently — won't break the bot if sheet is unavailable
// ============================================
// member = { name, telegram, username, group, team, userId }
async function appendToSheet(member, env) {
    if (!env.APPS_SCRIPT_URL) return; // Skip if not configured
    try {
        const res = await fetch(env.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: member.name,
                telegram: member.telegram,
                username: member.username,
                group: member.group,
                team: teamLabel(member.team),
                userId: member.userId.toString(),
                secret: env.SHEET_SECRET
            })
        });
        const result = await res.json().catch(() => null);
        if (!result || !result.success) console.error("Apps Script rejected:", result);
    } catch (err) {
        console.error("Apps Script error:", err);
        // Fail silently — don't break the bot
    }
}

// Remove a member's row from the Google Sheet (matched by User ID)
async function removeFromSheet(userId, env) {
    if (!env.APPS_SCRIPT_URL) return;
    try {
        const res = await fetch(env.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", userId: userId.toString(), secret: env.SHEET_SECRET })
        });
        const result = await res.json().catch(() => null);
        if (!result || !result.success) console.error("Apps Script rejected delete:", result);
    } catch (err) {
        console.error("Apps Script error:", err);
    }
}

// Make the Google Sheet match the bot's member list exactly
async function syncSheet(env) {
    if (!env.APPS_SCRIPT_URL) return { success: false, error: "APPS_SCRIPT_URL not set" };
    const list = await env.ATTENDANCE_KV.list({ prefix: "name_" });
    const members = [];
    for (const key of list.keys) {
        const userId = key.name.replace("name_", "");
        const name = await env.ATTENDANCE_KV.get(key.name);
        const group = await env.ATTENDANCE_KV.get(`group_${userId}`) || "-";
        const team = teamLabel(await getTeam(userId, env));
        members.push({ userId, name, group, team });
    }
    try {
        const res = await fetch(env.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync", members, secret: env.SHEET_SECRET })
        });
        return await res.json().catch(() => ({ success: false, error: "bad response" }));
    } catch (err) {
        return { success: false, error: err.toString() };
    }
}

// ============================================
// ADMIN NOTIFICATION
// Sends a Telegram message to admin when new member registers
// Also saves to Google Sheet
// ============================================
async function notifyAdmin(member, env) {
    if (!env.ADMIN_USER_ID) return;

    // Send Telegram notification to admin
    await sendMessage(
        parseInt(env.ADMIN_USER_ID),
        `🔔 *New member registered!*\n\nName: *${mdb(member.name)}*\nTele Display Name: ${md(member.telegram)}\nTele Username: ${md(member.username)}\nTeam: ${teamTag(member.team)}\nGroup: ${md(member.group)}\nUser ID: \`${member.userId}\``,
        env.BOT_TOKEN
    );

    // Move admin's main menu below the alert so it stays the latest message
    const adminId = parseInt(env.ADMIN_USER_ID);
    const oldMainId = await getMainMessageId(adminId, env);
    if (oldMainId) await deleteMessage(adminId, oldMainId, env.BOT_TOKEN);
    const homeScreen = await buildHomeScreen(adminId, env);
    const res = await sendKeyboard(adminId, homeScreen.text, homeScreen.keyboard, env.BOT_TOKEN);
    if (res && res.ok && res.result) {
        await saveMainMessageId(adminId, res.result.message_id, env);
    }
}


// ============================================
// SCREEN BUILDERS
// Each function returns { text, keyboard } for a specific screen
// These are called to build what the main message shows
// ============================================

// HOME SCREEN — shown to registered members
// Lists every event with the user's status and one-tap RSVP buttons
async function buildHomeScreen(userId, env) {
    const name = await getName(userId, env);
    const role = await getRole(userId, env);
    const team = await getTeam(userId, env);
    const events = (await getEvents(env)).filter(e => eventVisibleTo(e, team));

    let eventsText = "";
    const keyboard = { inline_keyboard: [] };

    if (events.length === 0) {
        eventsText = `📭 No upcoming events.`;
    }
    for (const event of events) {
        if (!event.active) {
            eventsText += `${eventEmoji(event)} ${eventLine(event)}\n⛔ _Cancelled — check with leaders_\n\n`;
            continue;
        }
        const status = await getRsvp(event.id, userId, env);
        const statusText = status === "coming" ? "✅ You're *COMING*"
            : status === "notcoming" ? "❌ You're *NOT COMING*"
            : "❓ Not RSVP'd yet";
        eventsText += `${eventEmoji(event)} ${eventLine(event)}\n${statusText}\n\n`;
        // 👉 marks the option the member already picked
        keyboard.inline_keyboard.push([
            { text: `${status === "coming" ? "👉 " : ""}✅ ${shortName(event.name)}`, callback_data: `rsvp_y_${event.id}` },
            { text: `${status === "notcoming" ? "👉 " : ""}❌ ${shortName(event.name)}`, callback_data: `rsvp_n_${event.id}` }
        ]);
    }

    const hint = keyboard.inline_keyboard.length ? `_Tap ✅ coming or ❌ not coming:_` : `_Tap a button below:_`;
    const text = `${greeting()}, *${mdb(name)}*!\n\n${eventsText.trim()}\n\n${hint}`;

    keyboard.inline_keyboard.push([{ text: "👤 My Profile", callback_data: "screen_profile" }]);

    // Leader buttons
    if (role === "leader" || role === "admin") {
        keyboard.inline_keyboard.push([
            { text: "📋 View List", callback_data: "screen_list" },
            { text: "📱 WhatsApp", callback_data: "screen_whatsapp" }
        ]);
        keyboard.inline_keyboard.push([
            { text: "👥 Manage Members", callback_data: "screen_manage_members" }
        ]);
    }

    // Admin buttons
    if (role === "admin") {
        keyboard.inline_keyboard.push([
            { text: "🗓 Manage Events", callback_data: "screen_events" },
            { text: "👥 Members", callback_data: "screen_members" }
        ]);
        keyboard.inline_keyboard.push([
            { text: "🧩 Groups", callback_data: "screen_groups" },
            { text: "🔑 Invite Code", callback_data: "screen_invite_code" }
        ]);
        keyboard.inline_keyboard.push([
            { text: "📊 Sync Sheet", callback_data: "action_sync_sheet" }
        ]);
    }

    // Leaders/admins can log out from home; members log in from My Profile
    if (role !== "member") {
        keyboard.inline_keyboard.push([
            { text: "🚪 Logout", callback_data: "action_logout" }
        ]);
    }

    return { text, keyboard };
}

// PROFILE SCREEN
async function buildProfileScreen(userId, env) {
    const name = await getName(userId, env);
    const team = await getTeam(userId, env);
    const group = await env.ATTENDANCE_KV.get(`group_${userId}`) || "-";
    const role = await getRole(userId, env);
    const roleLabel = role === "admin" ? "⚙️ Admin" : role === "leader" ? "🔐 Leader" : "👤 Member";
    const hasGroups = (await getGroups(team, env)).length > 0;

    return {
        text: `👤 *My Profile*\n\n*Name:* ${md(name)}\n*Team:* ${teamTag(team)}\n*Group:* ${md(group)}\n*Role:* ${roleLabel}\n*ID:* \`${userId}\``,
        keyboard: {
            inline_keyboard: [
                [{ text: "✏️ Update Name", callback_data: "input_name" }],
                hasGroups
                    ? [{ text: "👥 Change Group", callback_data: "screen_my_group" }, { text: "🔄 Change Team", callback_data: "screen_my_team" }]
                    : [{ text: "🔄 Change Team", callback_data: "screen_my_team" }],
                ...(role === "member" ? [[{ text: "🔐 Leader/Admin Login", callback_data: "screen_login" }]] : []),
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// LOGIN SCREEN
function buildLoginScreen() {
    return {
        text: `🔐 *Login*\n\nSelect your role to login:`,
        keyboard: {
            inline_keyboard: [
                [{ text: "🔐 Login as Leader", callback_data: "input_password_leader" }],
                [{ text: "🔐 Login as Admin", callback_data: "input_password_admin" }],
                [{ text: "🔙 Back", callback_data: "screen_profile" }]
            ]
        }
    };
}

// LIST SCREEN (Leaders only) — one section per event
async function buildListScreen(userId, env) {
    const scope = await scopeTeam(userId, env);
    const events = (await getEvents(env)).filter(e => !scope || eventVisibleTo(e, scope));
    let text = `📋 *Attendance List*${scope ? ` — ${teamTag(scope)}` : ""}\n`;
    if (events.length === 0) text += `\n📭 No events.`;

    for (const event of events) {
        text += `\n${eventEmoji(event)} ${eventLine(event)}${event.active ? "" : " ⛔ *(cancelled)*"}\n`;
        const teams = scope ? [scope] : TEAMS.map(([k]) => k).filter(t => eventVisibleTo(event, t));
        for (const team of teams) {
            const { coming, notcoming } = await getEventAttendance(event.id, env, true, team);
            if (!scope) text += `\n_${teamTag(team)}_\n`;
            text += `✅ *Coming (${coming.length}):*\n${coming.map(n => `• ${n}`).join("\n") || "• None"}\n`;
            text += `❌ *Not Coming (${notcoming.length}):*\n${notcoming.map(n => `• ${n}`).join("\n") || "• None"}\n`;
        }
    }

    return {
        text,
        keyboard: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] }
    };
}

// WHATSAPP SCREEN (Leaders only)
// One copy-paste block per active event: who's coming, grouped by ministry group.
// Each group ends with an empty numbered line so people can add themselves in WhatsApp.
// Shown in a code block so copying keeps WhatsApp's *bold* and _italic_ markers.
// WHATSAPP SCREEN (Leaders only) — one copy-paste block per active event for one team.
// Shown in a code block so copying keeps WhatsApp's *bold* and _italic_ markers.
async function buildWhatsappScreen(team, env) {
    const events = (await getEvents(env)).filter(e => e.active && eventVisibleTo(e, team));
    const format = await env.ATTENDANCE_KV.get(`wa_format_${team}`) || "groups";
    const formatName = (WA_FORMATS.find(([k]) => k === format) || WA_FORMATS[0])[1];

    let text = `📱 *WhatsApp Summary — ${teamTag(team)}*\nFormat: _${formatName}_\n\n`;
    if (events.length === 0) text += `📭 No upcoming events.\n`;
    else text += `_Tap a block to copy it, then paste into WhatsApp:_\n`;

    for (const event of events) {
        text += "\n```\n" + (await buildWhatsappText(event, team, env)).replace(/```/g, "'''") + "\n```\n";
    }

    const buttons = [[{ text: `🎨 Format: ${formatName}`, callback_data: `wafmt_${team}` }]];
    if (format === "custom") buttons.push([{ text: "✏️ Edit Template", callback_data: `watpl_${team}` }]);
    else buttons.push([{ text: "✏️ Edit Footer", callback_data: `wafoot_${team}` }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_whatsapp" }]);
    return { text, keyboard: { inline_keyboard: buttons } };
}

// Admins pick which team's summary to see; leaders go straight to their own
function buildWhatsappTeamPicker() {
    return {
        text: `📱 *WhatsApp Summary*\n\nWhich team?`,
        keyboard: {
            inline_keyboard: [
                ...TEAMS.map(([key]) => [{ text: teamTag(key), callback_data: `wa_${key}` }]),
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

function buildWhatsappFormatScreen(team) {
    return {
        text: `🎨 *WhatsApp Format — ${teamTag(team)}*\n\n`
            + `*By group* — who's coming, under each ministry group, with a blank number to add yourself\n`
            + `*Coming / Not coming* — two lists with counts\n`
            + `*Simple list* — one numbered list of who's coming\n`
            + `*Custom template* — write your own layout`,
        keyboard: {
            inline_keyboard: [
                ...WA_FORMATS.map(([key, label]) => [{ text: label, callback_data: `wafmtset_${team}_${key}` }]),
                [{ text: "🔙 Back", callback_data: `wa_${team}` }]
            ]
        }
    };
}

async function buildWhatsappText(event, team, env) {
    // Who's coming / not coming from this team, and coming grouped by ministry group
    const coming = [], notcoming = [], byGroup = {};
    const list = await env.ATTENDANCE_KV.list({ prefix: `rsvp_${event.id}_` });
    for (const key of list.keys) {
        const memberId = key.name.slice(`rsvp_${event.id}_`.length);
        const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
        if (!memberName || await getTeam(memberId, env) !== team) continue;
        const status = await env.ATTENDANCE_KV.get(key.name);
        if (status === "notcoming") { notcoming.push(memberName); continue; }
        if (status !== "coming") continue;
        coming.push(memberName);
        const group = await env.ATTENDANCE_KV.get(`group_${memberId}`) || NOT_SURE;
        (byGroup[group] = byGroup[group] || []).push(memberName);
    }
    const byName = (a, b) => a.localeCompare(b);
    coming.sort(byName); notcoming.sort(byName);
    const numbered = (names, blank) => names.map((n, i) => `${i + 1}. ${n}`).join("\n")
        + (blank ? `${names.length ? "\n" : ""}${names.length + 1}. ` : "");

    // Ministry groups in the team's order, then any old group names, "Not sure" last if used
    const order = await getGroups(team, env);
    const groupNames = [...order, ...Object.keys(byGroup).filter(g => !order.includes(g) && g !== NOT_SURE && g !== "-")];
    if (byGroup[NOT_SURE]) groupNames.push(NOT_SURE);
    if (byGroup["-"]) groupNames.push("-");
    const groupsBlock = order.length === 0 && groupNames.every(g => g === "-" || g === NOT_SURE)
        ? numbered(coming, true) // team without groups — plain list
        : groupNames.map(g => `_${g === "-" ? "Others" : g}_\n` + numbered((byGroup[g] || []).sort(byName), true)).join("\n\n");

    const format = await env.ATTENDANCE_KV.get(`wa_format_${team}`) || "groups";
    const teamName = teamLabel(team);

    if (format === "custom") {
        const template = await env.ATTENDANCE_KV.get(`wa_template_${team}`) || DEFAULT_WA_TEMPLATE;
        const values = {
            team: teamName, emoji: eventEmoji(event), event: event.name, date: event.when || "", location: event.location || "",
            coming: numbered(coming, false) || "None", notcoming: numbered(notcoming, false) || "None",
            coming_count: String(coming.length), notcoming_count: String(notcoming.length), groups: groupsBlock
        };
        return template
            .replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m))
            .split("\n").filter(line => !/^[-•]\s*$/.test(line.trim())).join("\n") // drop "- " lines left by empty fields
            .replace(/\n+$/, "");
    }

    let msg = `${eventEmoji(event)} *《${teamName} ${event.name} Attendance》*\n`;
    if (event.when) msg += `- ${event.when}\n`;
    if (event.location) msg += `- ${event.location}\n`;
    if (format === "split") {
        msg += `\n✅ *Coming (${coming.length})*\n${numbered(coming, false) || "None"}\n`;
        msg += `\n❌ *Not Coming (${notcoming.length})*\n${numbered(notcoming, false) || "None"}\n`;
    } else if (format === "simple") {
        msg += `\n${numbered(coming, true)}\n`;
    } else {
        msg += `\n${groupsBlock}\n`;
    }
    const footer = await getWaFooter(team, env);
    if (footer) msg += `\n${footer}`;
    return msg.replace(/\n+$/, ""); // keep the space after a trailing blank number
}

// MANAGE MEMBERS SCREEN (Leaders only)
function buildManageMembersScreen() {
    return {
        text: `👥 *Member Management*\n\nManage non-Telegram members here.\n\n_These are members without Telegram who need manual attendance._`,
        keyboard: {
            inline_keyboard: [
                [{ text: "➕ Add Member", callback_data: "input_add_member_name" }],
                [{ text: "📋 Mark Attendance", callback_data: "screen_mark_attendance" }],
                [{ text: "🗑️ Remove Member", callback_data: "screen_remove_member" }],
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// MARK ATTENDANCE — step 1: pick an event (skipped when there is only one)
async function buildMarkEventPickerScreen(userId, env) {
    const scope = await scopeTeam(userId, env);
    const events = (await getEvents(env)).filter(e => e.active && (!scope || eventVisibleTo(e, scope)));
    if (events.length === 1) return await buildMarkAttendanceScreen(userId, events[0].id, env);
    const buttons = events.map(e => [{ text: `${eventEmoji(e)} ${e.name}${e.when ? ` — ${e.when}` : ""}`, callback_data: `markev_${e.id}` }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_manage_members" }]);
    return {
        text: events.length ? `📋 *Mark Attendance*\n\nWhich event?` : `📋 *Mark Attendance*\n\n📭 No active events.`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MARK ATTENDANCE — step 2: non-Telegram members for one event
async function buildMarkAttendanceScreen(userId, eventId, env) {
    const event = await getEvent(eventId, env);
    const scope = await scopeTeam(userId, env);
    const all = await env.ATTENDANCE_KV.list({ prefix: "name_nontelegram:" });
    const list = { keys: [] };
    for (const key of all.keys) {
        const memberTeam = await getTeam(key.name.replace("name_", ""), env);
        if ((!scope || memberTeam === scope) && (!event || eventVisibleTo(event, memberTeam))) list.keys.push(key);
    }

    if (!event || list.keys.length === 0) {
        return {
            text: `📋 *Mark Attendance*\n\n${event ? "No non-Telegram members found.\n\nAdd members first using ➕ Add Member." : "Event not found."}`,
            keyboard: {
                inline_keyboard: [
                    [{ text: "➕ Add Member", callback_data: "input_add_member_name" }],
                    [{ text: "🔙 Back", callback_data: "screen_manage_members" }]
                ]
            }
        };
    }

    const buttons = [];
    for (const key of list.keys) {
        const memberName = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("name_", "");
        const status = await getRsvp(eventId, memberId, env);
        const statusIcon = status === "coming" ? "✅" : status === "notcoming" ? "❌" : "❓";
        buttons.push([{ text: `${statusIcon} ${memberName}`, callback_data: `mm_${eventId}_${memberId}` }]);
    }
    buttons.push([{ text: "🔙 Back", callback_data: "screen_mark_attendance" }]);

    return {
        text: `📋 *Mark Attendance*\n\n${eventEmoji(event)} ${eventLine(event)}\n\nTap a member to update:\n\n✅ Coming  ❌ Not Coming  ❓ No response`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MANAGE EVENTS SCREEN (Admin only)
async function buildEventsScreen(env) {
    const events = await getEvents(env);
    const buttons = events.map(e => [{
        text: `${e.active ? eventEmoji(e) : "⛔"} ${e.name}${e.when ? ` — ${e.when}` : ""}${e.team && e.team !== "both" ? ` · ${teamTag(e.team)}` : ""}`,
        callback_data: `ev_${e.id}`
    }]);
    buttons.push([{ text: "➕ Add Event", callback_data: "screen_add_event" }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_home" }]);
    return {
        text: `🗓 *Manage Events*\n\n${events.length ? "Tap an event to edit it:" : "📭 No events yet."}`,
        keyboard: { inline_keyboard: buttons }
    };
}

// ADD EVENT — pick a preset or custom name
function buildAddEventScreen() {
    const buttons = PRESET_EVENTS.map((name, i) => [{ text: `${eventEmoji({ name })} ${name}`, callback_data: `newev_${i}` }]);
    buttons.push([{ text: "✏️ Custom name", callback_data: "input_new_event_name" }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_events" }]);
    return {
        text: `➕ *Add Event*\n\nPick an event or type a custom name:`,
        keyboard: { inline_keyboard: buttons }
    };
}

// SINGLE EVENT SCREEN (Admin only)
async function buildEventDetailScreen(eventId, env) {
    const event = await getEvent(eventId, env);
    if (!event) return await buildEventsScreen(env);
    const { coming, notcoming } = await getEventAttendance(eventId, env, false);
    return {
        text: `${eventEmoji(event)} ${eventLine(event)}${event.team && event.team !== "both" ? "" : "\n" + teamTag("both")}\n\nStatus: ${event.active ? "✅ Open for RSVP" : "⛔ Cancelled"}\nRSVPs: ✅ ${coming.length}  ❌ ${notcoming.length}`,
        keyboard: {
            inline_keyboard: [
                [
                    { text: "✏️ Rename", callback_data: `evname_${eventId}` },
                    { text: "🕐 Date & Time", callback_data: `evwhen_${eventId}` }
                ],
                [
                    { text: "📍 Location", callback_data: `evloc_${eventId}` },
                    { text: "👥 Who's it for", callback_data: `evaud_${eventId}` }
                ],
                [{ text: `${eventEmoji(event)} Change Emoji`, callback_data: `evemo_${eventId}` }],
                [event.active
                    ? { text: "❌ Cancel Event", callback_data: `evoff_${eventId}` }
                    : { text: "✅ Reopen Event", callback_data: `evon_${eventId}` }],
                [
                    { text: "🧹 Clear RSVPs", callback_data: `evclr_${eventId}` },
                    { text: "🗑️ Delete Event", callback_data: `evdel_${eventId}` }
                ],
                [{ text: "🔙 Back", callback_data: "screen_events" }]
            ]
        }
    };
}

// REMOVE MEMBER SCREEN (Leaders only)
async function buildRemoveMemberScreen(userId, env) {
    const scope = await scopeTeam(userId, env);
    const all = await env.ATTENDANCE_KV.list({ prefix: "name_" });
    const list = { keys: [] };
    for (const key of all.keys) {
        if (!scope || await getTeam(key.name.replace("name_", ""), env) === scope) list.keys.push(key);
    }

    if (list.keys.length === 0) {
        return {
            text: `🗑️ *Remove Member*\n\nNo members found.`,
            keyboard: {
                inline_keyboard: [
                    [{ text: "🔙 Back", callback_data: "screen_manage_members" }]
                ]
            }
        };
    }

    const buttons = [];
    for (const key of list.keys) {
        const memberName = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("name_", "");
        const isNonTelegram = memberId.startsWith("nontelegram:");
        const teamTag = scope ? "" : ` · ${teamTag(await getTeam(memberId, env))}`;
        buttons.push([{
            text: `🗑️ ${memberName}${isNonTelegram ? " (no Telegram)" : ""}${teamTag}`,
            callback_data: `remove_member_${memberId}`
        }]);
    }
    buttons.push([{ text: "🔙 Back", callback_data: "screen_manage_members" }]);

    return {
        text: `🗑️ *Remove Member*\n\nTap a member to remove them from the bot and the Google Sheet:`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MEMBERS SCREEN (Admin only)
async function buildMembersScreen(env) {
    const list = await env.ATTENDANCE_KV.list({ prefix: "name_" });
    const byTeam = {};

    for (const key of list.keys) {
        const memberName = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("name_", "");
        const team = await getTeam(memberId, env);
        const group = await env.ATTENDANCE_KV.get(`group_${memberId}`) || "-";
        const id = memberId.startsWith("nontelegram:") ? "no Telegram" : memberId;
        (byTeam[team] = byTeam[team] || []).push(`• ${md(memberName)} — ${md(group)} (${id})`);
    }

    let text = `👥 *Members*\n`;
    for (const [team] of TEAMS) {
        const rows = byTeam[team] || [];
        text += `\n*${teamTag(team)} (${rows.length})*\n${rows.join("\n") || "None yet"}\n`;
    }
    return {
        text,
        keyboard: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] }
    };
}

// MINISTRY GROUP PICKER (shown during registration)
async function buildGroupPickerScreen(name, team, env) {
    return {
        text: `👥 *Almost done, ${mdb(name)}!*\n\nPlease select your ministry group:\n\n_Not sure? Pick "Not sure" — you can change it later in My Profile._`,
        keyboard: { inline_keyboard: await groupButtons(team, "group_", env) }
    };
}

// TEAM PICKER (shown during registration)
function buildTeamPickerScreen(name) {
    return {
        text: `👥 *Hi ${mdb(name)}!*\n\nWhich team are you in?`,
        keyboard: { inline_keyboard: TEAMS.map(([key]) => [{ text: teamTag(key), callback_data: `regteam_${key}` }]) }
    };
}

// CHANGE MY GROUP (from My Profile)
async function buildMyGroupScreen(userId, env) {
    const current = await env.ATTENDANCE_KV.get(`group_${userId}`) || "-";
    const buttons = await groupButtons(await getTeam(userId, env), "mygrp_", env);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_profile" }]);
    return {
        text: `👥 *Change Group*\n\nCurrent: *${mdb(current)}*\n\nPick your ministry group:`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MANAGE GROUPS (Admin) — edit each team's ministry group list
async function buildGroupsScreen(team, env) {
    const groups = await getGroups(team, env);
    const buttons = groups.map((g, i) => [{ text: `🗑️ ${g}`, callback_data: `grpdel_${team}_${i}` }]);
    buttons.push([{ text: "➕ Add Group", callback_data: `grpadd_${team}` }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_groups" }]);
    return {
        text: `🧩 *${teamTag(team)} Groups*\n\n${groups.length ? groups.map((g, i) => `${i + 1}. ${md(g)}`).join("\n") : "_No groups — members skip the group step and the WhatsApp summary is one list._"}\n\n_Tap a group to delete it. Members already in a deleted group keep it until they change._`,
        keyboard: { inline_keyboard: buttons }
    };
}

// Shared team picker: callback = prefix + team
function buildTeamChoice(title, prefix, back) {
    return {
        text: title,
        keyboard: {
            inline_keyboard: [
                ...TEAMS.map(([key]) => [{ text: teamTag(key), callback_data: `${prefix}${key}` }]),
                [{ text: "🔙 Back", callback_data: back }]
            ]
        }
    };
}

// Save registration once team (and group, if the team has groups) are chosen
async function finishRegistration(userId, chatId, messageId, pending, group, env) {
    const { name, alreadyRegistered, telegramName, username, team } = pending;
    await env.ATTENDANCE_KV.delete(`reg_pending_${userId}`);
    await env.ATTENDANCE_KV.put(`name_${userId}`, name);
    await env.ATTENDANCE_KV.put(`approved_${userId}`, "true");
    await env.ATTENDANCE_KV.put(`team_${userId}`, team);
    await env.ATTENDANCE_KV.put(`group_${userId}`, group);

    const homeScreen = await buildHomeScreen(userId, env);
    await editMessageWithKeyboard(chatId, messageId,
        `${alreadyRegistered ? "✅ Updated" : "🎉 Welcome"}, *${mdb(name)}*! 🙏\n\nTeam: *${teamTag(team)}*${group !== "-" ? `\nGroup: *${mdb(group)}*` : ""}\n\n` + homeScreen.text,
        homeScreen.keyboard,
        env.BOT_TOKEN
    );
    await saveMainMessageId(userId, messageId, env);

    const member = { name, telegram: telegramName, username, group, team, userId };
    await appendToSheet(member, env);
    if (!alreadyRegistered) await notifyAdmin(member, env);
}

// Registration data saved while the member picks team/group (creator gets one made on the fly)
async function getRegPending(userId, query, env) {
    const raw = await env.ATTENDANCE_KV.get(`reg_pending_${userId}`);
    if (raw) return JSON.parse(raw);
    if (userId !== parseInt(env.ADMIN_USER_ID)) return null;
    const tgName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
    const savedName = await env.ATTENDANCE_KV.get(`name_${userId}`);
    return {
        name: savedName || env.ADMIN_NAME || tgName,
        alreadyRegistered: savedName !== null,
        telegramName: tgName,
        username: query.from.username ? `@${query.from.username}` : "-"
    };
}

// Ask the group for a new non-Telegram member (skipped if their team has no groups)
async function askAddMemberGroup(userId, chatId, messageId, pending, env) {
    if ((await getGroups(pending.team, env)).length === 0) {
        await saveNonTelegramMember(userId, chatId, messageId, pending, "-", env);
        return;
    }
    await editMessageWithKeyboard(chatId, messageId,
        `👥 *Select group for ${mdb(pending.name)}:*`,
        { inline_keyboard: [...await groupButtons(pending.team, "add_member_group_", env), [{ text: "❌ Cancel", callback_data: "screen_manage_members" }]] },
        env.BOT_TOKEN
    );
}

async function saveNonTelegramMember(userId, chatId, messageId, pending, group, env) {
    await env.ATTENDANCE_KV.delete(`add_member_pending_${userId}`);
    const memberId = `nontelegram:${pending.name}`;
    await env.ATTENDANCE_KV.put(`name_${memberId}`, pending.name);
    await env.ATTENDANCE_KV.put(`group_${memberId}`, group);
    await env.ATTENDANCE_KV.put(`team_${memberId}`, pending.team);
    await appendToSheet({ name: pending.name, telegram: "-", username: "-", group, team: pending.team, userId: memberId }, env);
    const screen = buildManageMembersScreen();
    await editMessageWithKeyboard(chatId, messageId,
        `✅ *${mdb(pending.name)}* added to *${teamTag(pending.team)}*!${group !== "-" ? `\nGroup: *${mdb(group)}*` : ""}\n\n` + screen.text,
        screen.keyboard, env.BOT_TOKEN
    );
}

// ============================================
// INPUT PROMPT HELPER
// Shows a temporary prompt asking user to type something
// Saves what we're waiting for in KV so text handler knows what to do
// ============================================
async function promptInput(userId, chatId, messageId, promptType, promptText, env) {
    // Save what input we're waiting for
    await env.ATTENDANCE_KV.put(`input_pending_${userId}`, promptType, { expirationTtl: 300 }); // 5 min timeout

    // Edit main message to show the prompt
    await editMessageWithKeyboard(
        chatId,
        messageId,
        promptText,
        { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "screen_home" }]] },
        env.BOT_TOKEN
    );
}


// ============================================
// MAIN REQUEST HANDLER
// Routes webhook requests from Telegram
// ============================================
async function handleRequest(request, env) {
    const url = new URL(request.url);

    // Webhook endpoint — receives all Telegram updates
    if (url.pathname === `/webhook/${env.BOT_TOKEN}` && request.method === "POST") {
        try {
            const update = await request.json();
            await handleUpdate(update, env);
        } catch (err) {
            console.error("Update failed:", err);
        }
        return new Response("OK");
    }

    return new Response("SP Navigators Bot is running! ✅");
}


// ============================================
// MAIN UPDATE HANDLER
// Processes all incoming Telegram messages and button taps
// ============================================
async function handleUpdate(update, env) {

    // ==========================================
    // BUTTON CLICK HANDLER (callback_query)
    // Handles all inline keyboard button taps
    // ==========================================
    if (update.callback_query) {
        const query = update.callback_query;

        // Always answer callback first to remove Telegram's loading spinner
        await answerCallback(query.id, env.BOT_TOKEN);

        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data; // The callback_data from the button

        // ===== SCREEN NAVIGATION BUTTONS =====
        // These buttons switch between different screens by editing the main message

        if (data === "screen_home") {
            // Check if user is approved/registered first
            const approvedUser = await isApproved(userId, env);
            const registeredName = await env.ATTENDANCE_KV.get(`name_${userId}`);

            if (!approvedUser || !registeredName) {
                // Not registered — send back to welcome screen
                await editMessageWithKeyboard(chatId, messageId,
                    `🙏 *Welcome to SP Navigators Attendance Bot!*\n\nThis bot is for SP Navigators members only.\n\nTo join, you need an invite code from your leader.\n\nTap below to get started:`,
                    { inline_keyboard: [
                        [{ text: "🔑 I have an invite code", callback_data: "input_invite_code" }]
                    ]},
                    env.BOT_TOKEN
                );
                return;
            }

            // Registered — show home screen
            const screen = await buildHomeScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_profile") {
            // Go to profile screen
            const screen = await buildProfileScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_login") {
            // Go to login screen
            const screen = buildLoginScreen();
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_list") {
            // Go to attendance list (leaders only)
            const leader = await isLeader(userId, env);
            if (!leader) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Leaders only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = await buildListScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_whatsapp") {
            // Go to WhatsApp summary (leaders only)
            const leader = await isLeader(userId, env);
            if (!leader) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Leaders only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = (await isAdmin(userId, env))
                ? buildWhatsappTeamPicker()
                : await buildWhatsappScreen(await getTeam(userId, env), env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (/^(wa|wafmt|wafmtset|watpl|wafoot)_/.test(data)) {
            // WhatsApp summary for one team + its format settings.
            // Leaders: own team only. Admins: any team.
            const parts = data.split("_");
            const team = parts[1];
            if (!TEAMS.some(([k]) => k === team) || !(await isLeader(userId, env))) return;
            if (!(await isAdmin(userId, env)) && team !== await getTeam(userId, env)) return;
            if (parts[0] === "wafmt") {
                const screen = buildWhatsappFormatScreen(team);
                await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
                return;
            }
            if (parts[0] === "watpl") {
                const current = await env.ATTENDANCE_KV.get(`wa_template_${team}`) || DEFAULT_WA_TEMPLATE;
                await promptInput(userId, chatId, messageId, `wa_template:${team}`,
                    `✏️ *Custom Template — ${teamTag(team)}*\n\nType the whole message. These get filled in:\n`
                    + "`{emoji}` `{team}` `{event}` `{date}` `{location}`\n`{groups}` — coming, by ministry group\n`{coming}` `{notcoming}` — numbered lists\n`{coming_count}` `{notcoming_count}`\n\nCurrent:\n```\n" + current.replace(/```/g, "'''") + "\n```",
                    env
                );
                return;
            }
            if (parts[0] === "wafoot") {
                await promptInput(userId, chatId, messageId, `wa_footer:${team}`,
                    `✏️ *WhatsApp Footer — ${teamTag(team)}*\n\nType the last line for the summary:\n\nExample: \`✝️🏃🏻‍♂️💨\`\n\n_Type_ \`-\` _for no footer._`,
                    env
                );
                return;
            }
            let note = "";
            if (parts[0] === "wafmtset" && WA_FORMATS.some(([k]) => k === parts[2])) {
                await env.ATTENDANCE_KV.put(`wa_format_${team}`, parts[2]);
                note = `✅ Format updated.\n\n`;
            }
            const screen = await buildWhatsappScreen(team, env);
            await editMessageWithKeyboard(chatId, messageId, note + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_events" || data === "screen_add_event" || data.startsWith("ev_")) {
            // Event management screens (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Admin only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = data === "screen_events" ? await buildEventsScreen(env)
                : data === "screen_add_event" ? buildAddEventScreen()
                : await buildEventDetailScreen(data.slice(3), env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("evaud_") || data.startsWith("evaudset_")) {
            // Change who an event is for (admin only)
            if (!(await isAdmin(userId, env))) return;
            if (data.startsWith("evaud_")) {
                const eventId = data.slice(6);
                await editMessageWithKeyboard(chatId, messageId,
                    `👥 *Who is this event for?*`,
                    { inline_keyboard: [...audienceButtons(`evaudset_${eventId}_`), [{ text: "🔙 Back", callback_data: `ev_${eventId}` }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const [, eventId, team] = data.split("_");
            const events = await getEvents(env);
            const event = events.find(e => e.id === eventId);
            if (event && (team === "both" || TEAMS.some(([k]) => k === team))) {
                event.team = team;
                await saveEvents(events, env);
            }
            const screen = await buildEventDetailScreen(eventId, env);
            await editMessageWithKeyboard(chatId, messageId, `✅ Updated.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("evemo_") || data.startsWith("evemoset_")) {
            // Pick an emoji for an event (admin only)
            if (!(await isAdmin(userId, env))) return;
            if (data.startsWith("evemo_")) {
                const eventId = data.slice(6);
                const row = i => EVENT_EMOJI_CHOICES.slice(i, i + 4).map((e, j) => ({ text: e, callback_data: `evemoset_${eventId}_${i + j}` }));
                await editMessageWithKeyboard(chatId, messageId,
                    `😀 *Pick an emoji for this event:*`,
                    { inline_keyboard: [row(0), row(4), row(8), [{ text: "↩️ Automatic", callback_data: `evemoset_${eventId}_auto` }], [{ text: "🔙 Back", callback_data: `ev_${eventId}` }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const [, eventId, choice] = data.split("_");
            const events = await getEvents(env);
            const event = events.find(e => e.id === eventId);
            if (event) {
                if (choice === "auto") delete event.emoji;
                else if (EVENT_EMOJI_CHOICES[parseInt(choice)]) event.emoji = EVENT_EMOJI_CHOICES[parseInt(choice)];
                await saveEvents(events, env);
            }
            const screen = await buildEventDetailScreen(eventId, env);
            await editMessageWithKeyboard(chatId, messageId, `✅ Updated.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("newaud_")) {
            // Admin chose who a new event is for — now ask date & time
            if (!(await isAdmin(userId, env))) return;
            const team = data.slice(7);
            const name = await env.ATTENDANCE_KV.get(`new_event_pending_${userId}`);
            if (!name || name.startsWith("{")) {
                const screen = await buildEventsScreen(env);
                await editMessageWithKeyboard(chatId, messageId, `❌ Expired. Please add the event again.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
                return;
            }
            await env.ATTENDANCE_KV.put(`new_event_pending_${userId}`, JSON.stringify({ name, team }), { expirationTtl: 300 });
            await promptInput(userId, chatId, messageId, "new_event_when",
                `🕐 *${mdb(name)}* — ${teamTag(team)}\n\nType the date & time in one go:\n\nExample: \`Fri 17 Oct, 5:30pm\``,
                env
            );
            return;

        } else if (data === "screen_groups" || data.startsWith("grps_") || data.startsWith("grpdel_") || data.startsWith("grpadd_")) {
            // Edit each team's ministry groups (admin only)
            if (!(await isAdmin(userId, env))) return;
            if (data === "screen_groups") {
                const screen = buildTeamChoice(`🧩 *Ministry Groups*\n\nWhich team?`, "grps_", "screen_home");
                await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
                return;
            }
            const [action, team, index] = data.split("_");
            if (!TEAMS.some(([k]) => k === team)) return;
            if (action === "grpadd") {
                await promptInput(userId, chatId, messageId, `group_add:${team}`,
                    `➕ *New ${teamTag(team)} Group*\n\nType the group name:\n\nExample: \`Group 1\``,
                    env
                );
                return;
            }
            let note = "";
            if (action === "grpdel") {
                const groups = await getGroups(team, env);
                const removed = groups.splice(parseInt(index), 1)[0];
                await saveGroups(team, groups, env);
                if (removed) note = `🗑️ *${mdb(removed)}* removed.\n\n`;
            }
            const screen = await buildGroupsScreen(team, env);
            await editMessageWithKeyboard(chatId, messageId, note + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_my_team" || data.startsWith("myteam_")) {
            // Member changes team; group resets (pick again if the new team has groups)
            if (!(await env.ATTENDANCE_KV.get(`name_${userId}`))) return;
            if (data === "screen_my_team") {
                const screen = buildTeamChoice(`🔄 *Change Team*\n\nCurrent: *${teamTag(await getTeam(userId, env))}*`, "myteam_", "screen_profile");
                await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
                return;
            }
            const team = data.slice(7);
            if (!TEAMS.some(([k]) => k === team)) return;
            const hasGroups = (await getGroups(team, env)).length > 0;
            await env.ATTENDANCE_KV.put(`team_${userId}`, team);
            await env.ATTENDANCE_KV.put(`group_${userId}`, hasGroups ? NOT_SURE : "-");
            await appendToSheet({
                name: await getName(userId, env),
                telegram: [query.from.first_name, query.from.last_name].filter(Boolean).join(" "),
                username: query.from.username ? `@${query.from.username}` : "-",
                group: hasGroups ? NOT_SURE : "-", team, userId
            }, env);
            const screen = hasGroups ? await buildMyGroupScreen(userId, env) : await buildProfileScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ Team changed to *${teamTag(team)}*.${hasGroups ? " Now pick your group:" : ""}\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("amteam_")) {
            // Admin picked the team for a new non-Telegram member
            if (!(await isAdmin(userId, env))) return;
            const team = data.slice(7);
            const raw = await env.ATTENDANCE_KV.get(`add_member_pending_${userId}`);
            if (!raw || !TEAMS.some(([k]) => k === team)) return;
            const pending = { ...JSON.parse(raw), team };
            await env.ATTENDANCE_KV.put(`add_member_pending_${userId}`, JSON.stringify(pending), { expirationTtl: 300 });
            await askAddMemberGroup(userId, chatId, messageId, pending, env);
            return;

        } else if (data === "screen_members") {
            // Go to members list (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Admin only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = await buildMembersScreen(env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        // ===== INPUT PROMPT BUTTONS =====
        // These ask the user to type something

        } else if (data === "input_invite_code") {
            // Stranger tapped "I have an invite code" button
            await promptInput(userId, chatId, messageId, "invite_code",
                `🔑 *Enter Invite Code*\n\nPlease type your invite code:`,
                env
            );
            return;
        
        } else if (data === "input_password_leader") {
            // Ask user to type leader password
            await promptInput(userId, chatId, messageId, "password_leader",
                `🔐 *Leader Login*\n\nPlease type the leader password:`,
                env
            );
            return;

        } else if (data === "input_password_admin") {
            // Ask user to type admin password
            await promptInput(userId, chatId, messageId, "password_admin",
                `🔐 *Admin Login*\n\nPlease type the admin password:`,
                env
            );
            return;

        } else if (data === "screen_my_group") {
            const screen = await buildMyGroupScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("mygrp_")) {
            // Member changed their own ministry group
            if (!(await env.ATTENDANCE_KV.get(`name_${userId}`))) return;
            const team = await getTeam(userId, env);
            const groupName = await groupFromButton(team, data.slice(6), env);
            await env.ATTENDANCE_KV.put(`group_${userId}`, groupName);
            await appendToSheet({
                name: await getName(userId, env),
                telegram: [query.from.first_name, query.from.last_name].filter(Boolean).join(" "),
                username: query.from.username ? `@${query.from.username}` : "-",
                group: groupName, team, userId
            }, env);
            const screen = await buildProfileScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ Group changed to *${mdb(groupName)}*\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_invite_code") {
            // Show the current invite code (admin only)
            if (!(await isAdmin(userId, env))) return;
            const code = await getInviteCode(env);
            await editMessageWithKeyboard(chatId, messageId,
                `🔑 *Invite Code*\n\nCurrent code: \`${String(code).replace(/`/g, "'")}\`\n\n_Send this to new members so they can register. Changing it doesn't affect members who already registered._`,
                { inline_keyboard: [
                    [{ text: "✏️ Change Code", callback_data: "input_invite_code_set" }],
                    [{ text: "🔙 Back", callback_data: "screen_home" }]
                ]},
                env.BOT_TOKEN
            );
            return;

        } else if (data === "input_invite_code_set") {
            if (!(await isAdmin(userId, env))) return;
            await promptInput(userId, chatId, messageId, "invite_code_set",
                `✏️ *New Invite Code*\n\nType the new invite code (one word, no spaces):`,
                env
            );
            return;

        } else if (data === "input_name") {
            // Ask user to type new name (profile update)
            await promptInput(userId, chatId, messageId, "update_name",
                `✏️ *Update Name*\n\nPlease type your new full name:`,
                env
            );
            return;

        } else if (data === "input_new_event_name") {
            // Admin wants a custom event name
            if (!(await isAdmin(userId, env))) return;
            await promptInput(userId, chatId, messageId, "new_event_name",
                `✏️ *New Event*\n\nType the event name:`,
                env
            );
            return;

        } else if (data.startsWith("newev_")) {
            // Admin picked a preset — ask for date & time
            if (!(await isAdmin(userId, env))) return;
            const name = PRESET_EVENTS[parseInt(data.slice(6))];
            if (!name) return;
            await env.ATTENDANCE_KV.put(`new_event_pending_${userId}`, name, { expirationTtl: 300 });
            await editMessageWithKeyboard(chatId, messageId,
                `${eventEmoji({ name })} *${mdb(name)}*\n\nWho is this event for?`,
                { inline_keyboard: [...audienceButtons("newaud_"), [{ text: "❌ Cancel", callback_data: "screen_events" }]] },
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("evname_")) {
            if (!(await isAdmin(userId, env))) return;
            await promptInput(userId, chatId, messageId, `event_name:${data.slice(7)}`,
                `✏️ *Rename Event*\n\nType the new name:`,
                env
            );
            return;

        } else if (data === "evskiploc") {
            // Admin skipped location while adding an event — create it without one
            if (!(await isAdmin(userId, env))) return;
            await env.ATTENDANCE_KV.delete(`input_pending_${userId}`);
            const note = await createPendingEvent(userId, "", env);
            const screen = await buildEventsScreen(env);
            await editMessageWithKeyboard(chatId, messageId, note + `\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("evloc_")) {
            if (!(await isAdmin(userId, env))) return;
            await promptInput(userId, chatId, messageId, `event_location:${data.slice(6)}`,
                `📍 *Location*\n\nType the location:\n\nExample: \`SP Chapel\`\n\n_Type_ \`-\` _to remove it._`,
                env
            );
            return;

        } else if (data.startsWith("evwhen_")) {
            if (!(await isAdmin(userId, env))) return;
            await promptInput(userId, chatId, messageId, `event_when:${data.slice(7)}`,
                `🕐 *Date & Time*\n\nType the new date & time:\n\nExample: \`Fri 17 Oct, 5:30pm\``,
                env
            );
            return;

        } else if (data.startsWith("evoff_") || data.startsWith("evon_") || data.startsWith("evclr_") || data.startsWith("evdel_")) {
            // Cancel / reopen / clear RSVPs / delete one event (admin only)
            if (!(await isAdmin(userId, env))) return;
            const [action, eventId] = data.split("_");
            const events = await getEvents(env);
            const event = events.find(e => e.id === eventId);
            if (!event) return;
            let note;
            if (action === "evoff" || action === "evon") {
                event.active = action === "evon";
                await saveEvents(events, env);
                note = event.active ? `✅ *${mdb(event.name)}* reopened.` : `⛔ *${mdb(event.name)}* cancelled. Members will see a notice.`;
            } else if (action === "evclr") {
                await deleteKeysWithPrefix(`rsvp_${eventId}_`, env);
                note = `🧹 RSVPs cleared for *${mdb(event.name)}*.`;
            } else {
                await deleteKeysWithPrefix(`rsvp_${eventId}_`, env);
                await saveEvents(events.filter(e => e.id !== eventId), env);
                const screen = await buildEventsScreen(env);
                await editMessageWithKeyboard(chatId, messageId,
                    `🗑️ *${mdb(event.name)}* deleted.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
                return;
            }
            const screen = await buildEventDetailScreen(eventId, env);
            await editMessageWithKeyboard(chatId, messageId, note + `\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        // ===== ACTION BUTTONS =====
        // These perform an action and return to a screen

        } else if (data.startsWith("rsvp_y_") || data.startsWith("rsvp_n_")) {
            // One-tap RSVP from the home screen
            const eventId = data.slice(7);
            const event = await getEvent(eventId, env);
            let note;
            if (!event || !event.active || !eventVisibleTo(event, await getTeam(userId, env))) {
                note = `❌ That event is no longer open for RSVP.`;
            } else {
                const coming = data.startsWith("rsvp_y_");
                await env.ATTENDANCE_KV.put(`rsvp_${eventId}_${userId}`, coming ? "coming" : "notcoming");
                note = coming ? `🙌 See you at *${mdb(event.name)}*! Marked *COMING*.` : `😢 We'll miss you at *${mdb(event.name)}*. Marked *NOT COMING*.`;
            }
            const screen = await buildHomeScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, note + `\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "action_logout") {
            // Logout — remove role
            await env.ATTENDANCE_KV.delete(`role_${userId}`);
            const screen = await buildHomeScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `👋 Logged out successfully.\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_sync_sheet") {
            // Rebuild the Google Sheet from the bot's data (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            const result = await syncSheet(env);
            const screen = await buildHomeScreen(userId, env);
            const status = result && result.success
                ? `📊 *Sheet synced!* ${result.count} members.`
                : `❌ *Sync failed:* ${(result && result.error) || "unknown error"}`;
            await editMessageWithKeyboard(chatId, messageId,
                status + `\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "screen_manage_members") {
            // Member management screen (leaders only)
            const leader = await isLeader(userId, env);
            if (!leader) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Leaders only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = buildManageMembersScreen();
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_mark_attendance") {
            // Show list of non-telegram members to mark attendance
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const screen = await buildMarkEventPickerScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("markev_")) {
            // Leader picked which event to mark attendance for
            if (!(await isLeader(userId, env))) return;
            const screen = await buildMarkAttendanceScreen(userId, data.slice(7), env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_remove_member") {
            // Show list of non-telegram members to remove
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const screen = await buildRemoveMemberScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "input_add_member_name") {
            // Prompt leader to type new member name
            const leader = await isLeader(userId, env);
            if (!leader) return;
            await promptInput(userId, chatId, messageId, "add_member_name",
                `➕ *Add Member*\n\nType the full name of the member to add:`,
                env
            );
            return;

        } else if (data.startsWith("mm_")) {
            // Leader tapped a member — show Coming/Not Coming buttons
            // Format: mm_{eventId}_{memberId}
            if (!(await isLeader(userId, env))) return;
            const rest = data.slice(3);
            const eventId = rest.slice(0, rest.indexOf("_"));
            const memberId = rest.slice(rest.indexOf("_") + 1);
            const event = await getEvent(eventId, env);
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            const currentStatus = await getRsvp(eventId, memberId, env);
            const statusText = currentStatus === "coming" ? "✅ Currently: Coming"
                : currentStatus === "notcoming" ? "❌ Currently: Not Coming"
                : "❓ Currently: No response";
            await editMessageWithKeyboard(chatId, messageId,
                `📋 *Mark Attendance*\n\n${event ? `${eventEmoji(event)} ${eventLine(event)}` : ""}\n\n*${mdb(memberName)}*\n${statusText}\n\nUpdate to:`,
                { inline_keyboard: [
                    [
                        { text: "✅ Coming", callback_data: `sa_c_${eventId}_${memberId}` },
                        { text: "❌ Not Coming", callback_data: `sa_n_${eventId}_${memberId}` }
                    ],
                    [{ text: "🔙 Back", callback_data: `markev_${eventId}` }]
                ]},
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("sa_")) {
            // Set attendance for a non-telegram member
            // Format: sa_{c|n}_{eventId}_{memberId}
            if (!(await isLeader(userId, env))) return;
            const status = data[3] === "c" ? "coming" : "notcoming";
            const rest = data.slice(5);
            const eventId = rest.slice(0, rest.indexOf("_"));
            const memberId = rest.slice(rest.indexOf("_") + 1);
            const scope = await scopeTeam(userId, env);
            if (scope && await getTeam(memberId, env) !== scope) return;
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            await env.ATTENDANCE_KV.put(`rsvp_${eventId}_${memberId}`, status);
            const screen = await buildMarkAttendanceScreen(userId, eventId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `*${mdb(memberName)}* marked as *${status === "coming" ? "✅ Coming" : "❌ Not Coming"}*\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("remove_member_")) {
            // Remove a non-telegram member
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const memberId = data.replace("remove_member_", "");
            const scope = await scopeTeam(userId, env);
            if (scope && await getTeam(memberId, env) !== scope) return;
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            for (const prefix of ["name_", "group_", "team_", "approved_", "role_", "main_msg_"]) {
                await env.ATTENDANCE_KV.delete(`${prefix}${memberId}`);
            }
            for (const event of await getEvents(env)) {
                await env.ATTENDANCE_KV.delete(`rsvp_${event.id}_${memberId}`);
            }
            await removeFromSheet(memberId, env);
            const screen = await buildRemoveMemberScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *${mdb(memberName)}* removed.\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("add_member_group_")) {
            // Leader picked group for new non-telegram member
            if (!(await isLeader(userId, env))) return;
            const raw = await env.ATTENDANCE_KV.get(`add_member_pending_${userId}`);
            if (!raw || !raw.startsWith("{")) {
                const screen = buildManageMembersScreen();
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Expired. Please try again.\n\n` + screen.text,
                    screen.keyboard, env.BOT_TOKEN
                );
                return;
            }
            const pending = JSON.parse(raw);
            const groupName = await groupFromButton(pending.team, data.replace("add_member_group_", ""), env);
            await saveNonTelegramMember(userId, chatId, messageId, pending, groupName, env);
            return;

        // ===== TEAM + GROUP SELECTION (during registration) =====
        } else if (data.startsWith("regteam_")) {
            const team = data.slice(8);
            const pending = await getRegPending(userId, query, env);
            if (!pending || !TEAMS.some(([k]) => k === team)) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ *Registration expired.*\n\nPlease type /start and try again.`,
                    { inline_keyboard: [] },
                    env.BOT_TOKEN
                );
                return;
            }
            pending.team = team;
            if ((await getGroups(team, env)).length === 0) {
                await finishRegistration(userId, chatId, messageId, pending, "-", env);
                return;
            }
            await env.ATTENDANCE_KV.put(`reg_pending_${userId}`, JSON.stringify(pending), { expirationTtl: 600 });
            const screen = await buildGroupPickerScreen(pending.name, team, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("group_")) {
            const pending = await getRegPending(userId, query, env);
            if (!pending) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ *Registration expired.*\n\nPlease type /start and try again.`,
                    { inline_keyboard: [] },
                    env.BOT_TOKEN
                );
                return;
            }
            pending.team = pending.team || await getTeam(userId, env);
            const groupName = await groupFromButton(pending.team, data.replace("group_", ""), env);
            await finishRegistration(userId, chatId, messageId, pending, groupName, env);
            return;
        }

        return;
    }


    // ==========================================
    // TEXT MESSAGE HANDLER
    // Handles all typed messages from users
    // ==========================================
    if (!update.message) return;

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const userId = update.message.from.id;
    const userMessageId = update.message.message_id; // ID of what user just sent
    const firstName = update.message.from.first_name || "";
    const lastName = update.message.from.last_name || "";
    const telegramName = lastName ? `${firstName} ${lastName}` : firstName;
    const username = update.message.from.username ? `@${update.message.from.username}` : "-";

    if (!text) {
        // Photos, files, stickers, voice notes etc. — never expected, so remove them
        await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);
        return;
    }

    // ==========================================
    // AUTO APPROVE CREATOR (Admin/Jarrod)
    // The ADMIN_USER_ID person is auto-approved without needing invite code
    // ==========================================
    // const isCreator = userId === parseInt(env.ADMIN_USER_ID);
    // if (isCreator) {
    //     await env.ATTENDANCE_KV.put(`approved_${userId}`, "true");
    //     // Set admin name if not already set
    //     const existingName = await env.ATTENDANCE_KV.get(`name_${userId}`);
    //     if (!existingName) {
    //         const adminName = env.ADMIN_NAME || telegramName;
    //         await env.ATTENDANCE_KV.put(`name_${userId}`, adminName);
    //     }
    //     // ✅ If creator has no group yet — prompt group picker
    //     const existingGroup = await env.ATTENDANCE_KV.get(`group_${userId}`);
    //     if (!existingGroup && text === "/start") {
    //         await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);
    //         const groupScreen = buildGroupPickerScreen(env.ADMIN_NAME || telegramName);
    //         const res = await sendKeyboard(chatId, groupScreen.text, groupScreen.keyboard, env.BOT_TOKEN);
    //         if (res.ok && res.result) {
    //             await saveMainMessageId(userId, res.result.message_id, env);
    //         }
    //         return;
    //     }
    // }

    const isCreator = userId === parseInt(env.ADMIN_USER_ID);

    const approved = await isApproved(userId, env);

    // ==========================================
    // TEXT INPUT HANDLER
    // Handles typed responses to prompts (passwords, names, dates etc.)
    // Always deletes the user's message for security/cleanliness
    // ==========================================
    if (!text.startsWith("/")) {
        const inputPending = await env.ATTENDANCE_KV.get(`input_pending_${userId}`);

        if (inputPending) {
            // Delete user's message immediately (security + clean chat)
            await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);
            await env.ATTENDANCE_KV.delete(`input_pending_${userId}`);

            const mainMsgId = await getMainMessageId(userId, env);
            if (!mainMsgId) return; // No main message to edit — ignore

            // Handle based on what input we were waiting for
            if (inputPending === "invite_code") {
                // User typed invite code during registration
                if (text.trim() === await getInviteCode(env)) {
                    // Valid — now ask for their name
                    await env.ATTENDANCE_KV.put(`input_pending_${userId}`, "name", { expirationTtl: 300 });
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `✅ *Valid code!*\n\nPlease type your full name:`,
                        { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "screen_home" }]] },
                        env.BOT_TOKEN
                    );
                } else {
                    // Invalid code
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `❌ *Wrong invite code.*\n\nPlease check with your leader and try again.`,
                        { inline_keyboard: [
                            [{ text: "🔄 Try Again", callback_data: "input_invite_code" }],
                            [{ text: "🔙 Back", callback_data: "screen_home" }]
                        ]},
                        env.BOT_TOKEN
                    );
                }

            } else if (inputPending === "name") {
                // User typed their name during registration
                const existingName = await env.ATTENDANCE_KV.get(`name_${userId}`);
                const alreadyRegistered = existingName !== null;

                // Save pending registration data and show group picker
                await env.ATTENDANCE_KV.put(`reg_pending_${userId}`, JSON.stringify({
                    name: text,
                    alreadyRegistered,
                    telegramName,
                    username
                }), { expirationTtl: 600 }); // 10 min to pick group

                const teamScreen = buildTeamPickerScreen(text);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    teamScreen.text,
                    teamScreen.keyboard,
                    env.BOT_TOKEN
                );

            } else if (inputPending === "update_name") {
                // User typed new name from profile screen
                await env.ATTENDANCE_KV.put(`name_${userId}`, text);
                const screen = await buildProfileScreen(userId, env);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `✅ *Name updated to ${mdb(text)}!*\n\n` + screen.text,
                    screen.keyboard,
                    env.BOT_TOKEN
                );

            } else if (inputPending === "password_leader") {
                // User typed leader password
                const name = await getName(userId, env);
                if (text === env.LEADER_PASSWORD) {
                    await env.ATTENDANCE_KV.put(`role_${userId}`, "leader");
                    const screen = await buildHomeScreen(userId, env);
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `✅ *${mdb(name)}*, you are now logged in as *LEADER*!\n\n` + screen.text,
                        screen.keyboard,
                        env.BOT_TOKEN
                    );
                } else {
                    // Wrong password — show login screen again
                    const screen = buildLoginScreen();
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `❌ *Wrong leader password.* Try again.\n\n` + screen.text,
                        screen.keyboard,
                        env.BOT_TOKEN
                    );
                }

            } else if (inputPending === "password_admin") {
                // User typed admin password
                const name = await getName(userId, env);
                if (text === env.ADMIN_PASSWORD) {
                    await env.ATTENDANCE_KV.put(`role_${userId}`, "admin");
                    const screen = await buildHomeScreen(userId, env);
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `✅ *${mdb(name)}*, you are now logged in as *ADMIN*!\n\n` + screen.text,
                        screen.keyboard,
                        env.BOT_TOKEN
                    );
                } else {
                    const screen = buildLoginScreen();
                    await editMessageWithKeyboard(chatId, mainMsgId,
                        `❌ *Wrong admin password.* Try again.\n\n` + screen.text,
                        screen.keyboard,
                        env.BOT_TOKEN
                    );
                }

            } else if (inputPending === "new_event_name") {
                // Admin typed a custom event name — now ask for date & time
                await env.ATTENDANCE_KV.put(`new_event_pending_${userId}`, text, { expirationTtl: 300 });
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `${eventEmoji({ name: text })} *${mdb(text)}*\n\nWho is this event for?`,
                    { inline_keyboard: [...audienceButtons("newaud_"), [{ text: "❌ Cancel", callback_data: "screen_events" }]] },
                    env.BOT_TOKEN
                );

            } else if (inputPending === "new_event_when") {
                // Admin typed date & time — now ask for location (or skip)
                const raw = await env.ATTENDANCE_KV.get(`new_event_pending_${userId}`);
                if (!raw || !raw.startsWith("{")) {
                    const screen = await buildEventsScreen(env);
                    await editMessageWithKeyboard(chatId, mainMsgId, `❌ Expired. Please add the event again.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
                    return;
                }
                const { name, team } = JSON.parse(raw);
                await env.ATTENDANCE_KV.put(`new_event_pending_${userId}`, JSON.stringify({ name, team, when: text }), { expirationTtl: 300 });
                await env.ATTENDANCE_KV.put(`input_pending_${userId}`, "new_event_location", { expirationTtl: 300 });
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `📍 *${mdb(name)}* — ${md(text)}\n\nType the location:\n\nExample: \`SP Chapel\``,
                    { inline_keyboard: [
                        [{ text: "⏭ Skip", callback_data: "evskiploc" }],
                        [{ text: "❌ Cancel", callback_data: "screen_events" }]
                    ]},
                    env.BOT_TOKEN
                );

            } else if (inputPending === "new_event_location") {
                // Admin typed location — create the event
                const note = await createPendingEvent(userId, text, env);
                const screen = await buildEventsScreen(env);
                await editMessageWithKeyboard(chatId, mainMsgId, note + `\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);

            } else if (inputPending.startsWith("event_name:") || inputPending.startsWith("event_when:") || inputPending.startsWith("event_location:")) {
                // Admin renamed an event, or changed its date & time / location
                const [field, eventId] = inputPending.split(":");
                const events = await getEvents(env);
                const event = events.find(e => e.id === eventId);
                if (event) {
                    if (field === "event_name") event.name = text;
                    else if (field === "event_when") event.when = text;
                    else event.location = text.trim() === "-" ? "" : text; // "-" clears it
                    await saveEvents(events, env);
                }
                const screen = await buildEventDetailScreen(eventId, env);
                await editMessageWithKeyboard(chatId, mainMsgId, `✅ Updated.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);

            } else if (inputPending === "invite_code_set") {
                // Admin set a new invite code
                const code = text.trim();
                let note;
                if (!(await isAdmin(userId, env))) {
                    note = `❌ Admin only.`;
                } else if (!code || /\s/.test(code)) {
                    note = `❌ Invite code must be one word with no spaces. Not changed.`;
                } else {
                    await env.ATTENDANCE_KV.put("invite_code", code);
                    note = `✅ Invite code changed. The old code no longer works.`;
                }
                const screen = await buildHomeScreen(userId, env);
                await editMessageWithKeyboard(chatId, mainMsgId, note + `\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);

            } else if (inputPending.startsWith("wa_footer:") || inputPending.startsWith("wa_template:")) {
                // Leader changed their team's WhatsApp footer or custom template
                const [field, team] = inputPending.split(":");
                if (field === "wa_footer") await env.ATTENDANCE_KV.put(`wa_footer_${team}`, text.trim() === "-" ? "" : text);
                else await env.ATTENDANCE_KV.put(`wa_template_${team}`, text);
                const screen = await buildWhatsappScreen(team, env);
                await editMessageWithKeyboard(chatId, mainMsgId, `✅ Saved.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);

            } else if (inputPending.startsWith("group_add:")) {
                // Admin added a ministry group to a team
                const team = inputPending.split(":")[1];
                const groups = await getGroups(team, env);
                const name = text.trim();
                if (name && name !== NOT_SURE && !groups.includes(name)) {
                    groups.push(name);
                    await saveGroups(team, groups, env);
                }
                const screen = await buildGroupsScreen(team, env);
                await editMessageWithKeyboard(chatId, mainMsgId, `✅ Saved.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);

            } else if (inputPending === "add_member_name") {
                // Leader typed new non-telegram member name.
                // Admins pick the team; leaders add to their own team.
                const admin = await isAdmin(userId, env);
                const pending = { name: text, team: admin ? null : await getTeam(userId, env) };
                await env.ATTENDANCE_KV.put(`add_member_pending_${userId}`, JSON.stringify(pending), { expirationTtl: 300 });
                if (admin) {
                    const screen = buildTeamChoice(`👥 *Which team is ${mdb(text)} in?*`, "amteam_", "screen_manage_members");
                    await editMessageWithKeyboard(chatId, mainMsgId, screen.text, screen.keyboard, env.BOT_TOKEN);
                } else {
                    await askAddMemberGroup(userId, chatId, mainMsgId, pending, env);
                }
            }

            return; // ✅ Done — stop processing
        }

        // Not waiting for any input — remove the stray message to keep chat clean
        await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);
        return;
    }

    // ==========================================
    // /start COMMAND HANDLER
    // This is the ONLY command needed in the interactive version
    // Creates or recreates the persistent main message
    // ==========================================
    if (text === "/start") {

        // Delete the /start command message to keep chat clean
        await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);

        // STRANGER — not approved yet
        // if (!approved && !isCreator) {
        if (!approved) {
            // Send registration prompt (this becomes their main message)
            const res = await sendKeyboard(chatId,
                `🙏 *Welcome to SP Navigators Attendance Bot!*\n\nThis bot is for SP Navigators members only.\n\nTo join, you need an invite code from your leader.\n\nTap below to get started:`,
                { inline_keyboard: [
                    [{ text: "🔑 I have an invite code", callback_data: "input_invite_code" }]
                ]},
                env.BOT_TOKEN
            );
            // Save this as their main message
            if (res.ok && res.result) {
                await saveMainMessageId(userId, res.result.message_id, env);
            }
            return;
        }

        // APPROVED but not registered — shouldn't normally happen
        // but handle gracefully
        const existingName = await env.ATTENDANCE_KV.get(`name_${userId}`);
        //if (!existingName && !isCreator) {
        if (!existingName) {
            const res = await sendKeyboard(chatId,
                `👋 *Almost there!*\n\nYou're approved but need to complete registration.\n\nTap below:`,
                { inline_keyboard: [
                    [{ text: "🔑 Complete Registration", callback_data: "input_invite_code" }]
                ]},
                env.BOT_TOKEN
            );
            if (res.ok && res.result) {
                await saveMainMessageId(userId, res.result.message_id, env);
            }
            return;
        }

        // REGISTERED MEMBER — show home screen
        // If they already have a main message, delete it first (clean start)
        const oldMsgId = await getMainMessageId(userId, env);
        if (oldMsgId) {
            await deleteMessage(chatId, oldMsgId, env.BOT_TOKEN);
        }

        // Send fresh home screen
        const screen = await buildHomeScreen(userId, env);
        const res = await sendKeyboard(chatId, screen.text, screen.keyboard, env.BOT_TOKEN);
        if (res.ok && res.result) {
            await saveMainMessageId(userId, res.result.message_id, env);
        }
        return;
    }

    // Handle invite code button tap (callback) that needs text input
    // This is a special case — user tapped "I have invite code" button
    // We set input_pending and edit the main message to prompt
    // (handled via callback_query above for "input_invite_code")

    // Ignore all other commands — this is a button-based bot
    // Just delete the command message to keep chat clean
    await deleteMessage(chatId, userMessageId, env.BOT_TOKEN);
}


// ============================================
// WORKER ENTRY POINT
// ============================================
export default {
    async fetch(request, env) {
        return await handleRequest(request, env);
    }
};