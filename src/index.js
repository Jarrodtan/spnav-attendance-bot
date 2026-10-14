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
//   group_{userId}            — Ministry group name
//   main_msg_{userId}         — The persistent message ID to edit
//   input_pending_{userId}    — What text input we're waiting for
//   reg_pending_{userId}      — Temporary registration data while waiting for group selection (JSON)
//   events                    — JSON array of events: [{ id, name, when, location, active }]
//   rsvp_{eventId}_{userId}   — RSVP status for one event ("coming", "notcoming")
//   new_event_pending_{userId}— Event being added: name, then JSON { name, when } while asking location
// ============================================


// Preset event names offered when adding an event
const PRESET_EVENTS = ["Weekly Nav+U", "Prayer Walk", "VTP"];


// ============================================
// TELEGRAM API HELPERS
// ============================================

// Send a brand new message (returns the message object so we can save its ID)
async function sendMessage(chatId, text, token) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
    return await res.json(); // Return full response so caller can get message_id
}

// Send a new message WITH inline keyboard buttons (returns message object)
async function sendKeyboard(chatId, text, keyboard, token) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
            reply_markup: keyboard
        })
    });
    return await res.json();
}

// Edit the existing persistent message (text only, no keyboard)
async function editMessage(chatId, messageId, text, token) {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: "Markdown"
        })
    });
}

// Edit the existing persistent message WITH inline keyboard buttons
async function editMessageWithKeyboard(chatId, messageId, text, keyboard, token) {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: "Markdown",
            reply_markup: keyboard
        })
    });
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
    return `*${event.name}*${event.when ? ` — ${event.when}` : ""}${event.location ? `\n📍 ${event.location}` : ""}`;
}

// Create the event the admin has been typing (name + date & time saved in new_event_pending)
async function createPendingEvent(userId, location, env) {
    const raw = await env.ATTENDANCE_KV.get(`new_event_pending_${userId}`);
    await env.ATTENDANCE_KV.delete(`new_event_pending_${userId}`);
    if (!raw || !raw.startsWith("{")) return `❌ Expired. Please add the event again.`;
    const { name, when } = JSON.parse(raw);
    const events = await getEvents(env);
    const event = { id: newEventId(), name, when, location, active: true };
    events.push(event);
    await saveEvents(events, env);
    return `✅ Added ${eventLine(event)}`;
}

// Short label for buttons
function shortName(name) {
    return name.length > 16 ? name.slice(0, 15) + "…" : name;
}

async function getRsvp(eventId, userId, env) {
    return await env.ATTENDANCE_KV.get(`rsvp_${eventId}_${userId}`);
}

// Coming / not coming names for one event
async function getEventAttendance(eventId, env, withIds) {
    const list = await env.ATTENDANCE_KV.list({ prefix: `rsvp_${eventId}_` });
    const coming = [], notcoming = [];
    for (const key of list.keys) {
        const status = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.slice(`rsvp_${eventId}_`.length);
        const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
        if (!memberName) continue; // member was removed
        const label = withIds && !memberId.startsWith("nontelegram:") ? `${memberName} (${memberId})` : memberName;
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
async function appendToSheet(name, telegramName, username, ministryGroup, userId, env) {
    if (!env.APPS_SCRIPT_URL) return; // Skip if not configured
    try {
        const res = await fetch(env.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                telegram: telegramName,
                username,
                group: ministryGroup,
                userId: userId.toString(),
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
        members.push({ userId, name, group });
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
async function notifyAdmin(name, telegramName, username, ministryGroup, userId, env) {
    if (!env.ADMIN_USER_ID) return;

    // Send Telegram notification to admin
    await sendMessage(
        parseInt(env.ADMIN_USER_ID),
        `🔔 *New member registered!*\n\nName: *${name}*\nTele Display Name: ${telegramName}\nTele Username: ${username}\nGroup: ${ministryGroup}\nUser ID: \`${userId}\``,
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
    const events = await getEvents(env);

    let eventsText = "";
    const keyboard = { inline_keyboard: [] };

    if (events.length === 0) {
        eventsText = `📭 No upcoming events.`;
    }
    for (const event of events) {
        if (!event.active) {
            eventsText += `📅 ${eventLine(event)}\n❌ _Cancelled — check with leaders_\n\n`;
            continue;
        }
        const status = await getRsvp(event.id, userId, env);
        const statusText = status === "coming" ? "✅ You're *COMING*"
            : status === "notcoming" ? "❌ You're *NOT COMING*"
            : "❓ Not RSVP'd yet";
        eventsText += `📅 ${eventLine(event)}\n${statusText}\n\n`;
        keyboard.inline_keyboard.push([
            { text: `✅ ${shortName(event.name)}`, callback_data: `rsvp_y_${event.id}` },
            { text: `❌ ${shortName(event.name)}`, callback_data: `rsvp_n_${event.id}` }
        ]);
    }

    const hint = keyboard.inline_keyboard.length ? `_Tap ✅ coming or ❌ not coming:_` : `_Tap a button below:_`;
    const text = `🙏 *Welcome, ${name}!*\n\n${eventsText.trim()}\n\n${hint}`;

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
            { text: "📊 Sync Sheet", callback_data: "action_sync_sheet" }
        ]);
    }

    // Login/logout based on role
    if (role === "member") {
        keyboard.inline_keyboard.push([
            { text: "🔐 Leader/Admin Login", callback_data: "screen_login" }
        ]);
    } else {
        keyboard.inline_keyboard.push([
            { text: "🚪 Logout", callback_data: "action_logout" }
        ]);
    }

    return { text, keyboard };
}

// PROFILE SCREEN
async function buildProfileScreen(userId, env) {
    const name = await getName(userId, env);
    const group = await env.ATTENDANCE_KV.get(`group_${userId}`) || "Unassigned";
    const role = await getRole(userId, env);
    const roleLabel = role === "admin" ? "⚙️ Admin" : role === "leader" ? "🔐 Leader" : "👤 Member";

    return {
        text: `👤 *My Profile*\n\n*Name:* ${name}\n*Group:* ${group}\n*Role:* ${roleLabel}\n*ID:* \`${userId}\``,
        keyboard: {
            inline_keyboard: [
                [{ text: "✏️ Update Name", callback_data: "input_name" }],
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
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// LIST SCREEN (Leaders only) — one section per event
async function buildListScreen(env) {
    const events = await getEvents(env);
    let text = `📋 *Attendance List*\n`;
    if (events.length === 0) text += `\n📭 No events.`;

    for (const event of events) {
        const { coming, notcoming } = await getEventAttendance(event.id, env, true);
        text += `\n📅 ${eventLine(event)}${event.active ? "" : " *(cancelled)*"}\n`;
        text += `✅ *Coming (${coming.length}):*\n${coming.map(n => `• ${n}`).join("\n") || "• None"}\n`;
        text += `❌ *Not Coming (${notcoming.length}):*\n${notcoming.map(n => `• ${n}`).join("\n") || "• None"}\n`;
    }

    return {
        text,
        keyboard: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] }
    };
}

// WHATSAPP SCREEN (Leaders only) — copy-paste summary of all active events
async function buildWhatsappScreen(env) {
    const events = (await getEvents(env)).filter(e => e.active);
    let msg = `*《SP NAVIGATORS ATTENDANCE》*\n`;
    if (events.length === 0) msg += `\nNo upcoming events.\n`;

    for (const event of events) {
        const { coming, notcoming } = await getEventAttendance(event.id, env, false);
        msg += `\n📅 *${event.name}*\n🗓 ${event.when || "-"}\n${event.location ? `📍 ${event.location}\n` : ""}\n`;
        msg += `✅ *COMING (${coming.length})*\n`;
        coming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
        if (coming.length === 0) msg += `None\n`;
        msg += `\n❌ *NOT COMING (${notcoming.length})*\n`;
        notcoming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
        if (notcoming.length === 0) msg += `None\n`;
    }

    return {
        text: msg,
        keyboard: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] }
    };
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
async function buildMarkEventPickerScreen(env) {
    const events = (await getEvents(env)).filter(e => e.active);
    if (events.length === 1) return await buildMarkAttendanceScreen(events[0].id, env);
    const buttons = events.map(e => [{ text: `📅 ${e.name}${e.when ? ` — ${e.when}` : ""}`, callback_data: `markev_${e.id}` }]);
    buttons.push([{ text: "🔙 Back", callback_data: "screen_manage_members" }]);
    return {
        text: events.length ? `📋 *Mark Attendance*\n\nWhich event?` : `📋 *Mark Attendance*\n\n📭 No active events.`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MARK ATTENDANCE — step 2: non-Telegram members for one event
async function buildMarkAttendanceScreen(eventId, env) {
    const event = await getEvent(eventId, env);
    const list = await env.ATTENDANCE_KV.list({ prefix: "name_nontelegram:" });

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
        text: `📋 *Mark Attendance*\n\n📅 ${eventLine(event)}\n\nTap a member to update:\n\n✅ Coming  ❌ Not Coming  ❓ No response`,
        keyboard: { inline_keyboard: buttons }
    };
}

// MANAGE EVENTS SCREEN (Admin only)
async function buildEventsScreen(env) {
    const events = await getEvents(env);
    const buttons = events.map(e => [{
        text: `${e.active ? "📅" : "❌"} ${e.name}${e.when ? ` — ${e.when}` : ""}`,
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
    const buttons = PRESET_EVENTS.map((name, i) => [{ text: `📅 ${name}`, callback_data: `newev_${i}` }]);
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
        text: `🗓 ${eventLine(event)}\n\nStatus: ${event.active ? "✅ Open for RSVP" : "❌ Cancelled"}\nRSVPs: ✅ ${coming.length}  ❌ ${notcoming.length}`,
        keyboard: {
            inline_keyboard: [
                [
                    { text: "✏️ Rename", callback_data: `evname_${eventId}` },
                    { text: "🕐 Date & Time", callback_data: `evwhen_${eventId}` }
                ],
                [{ text: "📍 Location", callback_data: `evloc_${eventId}` }],
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
async function buildRemoveMemberScreen(env) {
    const list = await env.ATTENDANCE_KV.list({ prefix: "name_" });

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
        buttons.push([{
            text: `🗑️ ${memberName}${isNonTelegram ? " (no Telegram)" : ""}`,
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
    const members = [];

    for (const key of list.keys) {
        const memberName = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("name_", "");
        // Skip non-telegram members for now
        if (!memberId.startsWith("nontelegram:")) {
            members.push(`• ${memberName} (${memberId})`);
        }
    }

    return {
        text: `👥 *Registered Members (${members.length})*\n\n${members.join("\n") || "None yet"}`,
        keyboard: {
            inline_keyboard: [
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// MINISTRY GROUP PICKER (shown during registration)
function buildGroupPickerScreen(name) {
    return {
        text: `👥 *Almost done, ${name}!*\n\nPlease select your ministry group:\n\n_If unsure, check with your leader._`,
        keyboard: {
            inline_keyboard: [
                [{ text: "Refresher", callback_data: "group_refresher" }],
                [{ text: "Rescuer", callback_data: "group_rescuer" }],
                [{ text: "Repairer", callback_data: "group_repairer" }],
                [{ text: "Rebuilder", callback_data: "group_rebuilder" }],
                [{ text: "Recharger", callback_data: "group_recharger" }]
            ]
        }
    };
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
            const screen = await buildListScreen(env);
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
            const screen = await buildWhatsappScreen(env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
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
            await promptInput(userId, chatId, messageId, "new_event_when",
                `🕐 *${name}*\n\nType the date & time in one go:\n\nExample: \`Fri 17 Oct, 5:30pm\``,
                env
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
                note = event.active ? `✅ *${event.name}* reopened.` : `❌ *${event.name}* cancelled. Members will see a notice.`;
            } else if (action === "evclr") {
                await deleteKeysWithPrefix(`rsvp_${eventId}_`, env);
                note = `🧹 RSVPs cleared for *${event.name}*.`;
            } else {
                await deleteKeysWithPrefix(`rsvp_${eventId}_`, env);
                await saveEvents(events.filter(e => e.id !== eventId), env);
                const screen = await buildEventsScreen(env);
                await editMessageWithKeyboard(chatId, messageId,
                    `🗑️ *${event.name}* deleted.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
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
            if (!event || !event.active) {
                note = `❌ That event is no longer open for RSVP.`;
            } else {
                const coming = data.startsWith("rsvp_y_");
                await env.ATTENDANCE_KV.put(`rsvp_${eventId}_${userId}`, coming ? "coming" : "notcoming");
                note = coming ? `✅ Marked *COMING* to *${event.name}* 🙏` : `❌ Marked *NOT COMING* to *${event.name}*`;
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
            const screen = await buildMarkEventPickerScreen(env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data.startsWith("markev_")) {
            // Leader picked which event to mark attendance for
            if (!(await isLeader(userId, env))) return;
            const screen = await buildMarkAttendanceScreen(data.slice(7), env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_remove_member") {
            // Show list of non-telegram members to remove
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const screen = await buildRemoveMemberScreen(env);
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
                `📋 *Mark Attendance*\n\n📅 ${event ? eventLine(event) : ""}\n\n*${memberName}*\n${statusText}\n\nUpdate to:`,
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
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            await env.ATTENDANCE_KV.put(`rsvp_${eventId}_${memberId}`, status);
            const screen = await buildMarkAttendanceScreen(eventId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `*${memberName}* marked as *${status === "coming" ? "✅ Coming" : "❌ Not Coming"}*\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("remove_member_")) {
            // Remove a non-telegram member
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const memberId = data.replace("remove_member_", "");
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            for (const prefix of ["name_", "group_", "approved_", "role_", "main_msg_"]) {
                await env.ATTENDANCE_KV.delete(`${prefix}${memberId}`);
            }
            for (const event of await getEvents(env)) {
                await env.ATTENDANCE_KV.delete(`rsvp_${event.id}_${memberId}`);
            }
            await removeFromSheet(memberId, env);
            const screen = await buildRemoveMemberScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *${memberName}* removed.\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("add_member_group_")) {
            // Leader picked group for new non-telegram member
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const group = data.replace("add_member_group_", "");
            const groupLabel = group.charAt(0).toUpperCase() + group.slice(1);
            const memberName = await env.ATTENDANCE_KV.get(`add_member_pending_${userId}`);
            if (!memberName) {
                const screen = buildManageMembersScreen();
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Expired. Please try again.\n\n` + screen.text,
                    screen.keyboard, env.BOT_TOKEN
                );
                return;
            }
            await env.ATTENDANCE_KV.delete(`add_member_pending_${userId}`);
            const memberId = `nontelegram:${memberName}`;
            await env.ATTENDANCE_KV.put(`name_${memberId}`, memberName);
            await env.ATTENDANCE_KV.put(`group_${memberId}`, groupLabel);
            await appendToSheet(memberName, "-", "-", groupLabel, memberId, env);
            const screen = buildManageMembersScreen();
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *${memberName}* added!\nGroup: *${groupLabel}*\n\n` + screen.text,
                screen.keyboard, env.BOT_TOKEN
            );
            return;

        // ===== GROUP SELECTION (during registration) =====
        } else if (data.startsWith("group_")) {
            const group = data.replace("group_", "");
            const groupLabel = group.charAt(0).toUpperCase() + group.slice(1);

            // Check if creator — they don't have reg_pending
            const isCreatorUser = userId === parseInt(env.ADMIN_USER_ID);
            let name, alreadyRegistered, telegramName, username;

            const creatorPending = isCreatorUser ? await env.ATTENDANCE_KV.get(`reg_pending_${userId}`) : null;

            if (isCreatorUser && !creatorPending) {
                // Creator without a typed name — use saved name, ADMIN_NAME, or Telegram name
                const tgName = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");
                const savedName = await env.ATTENDANCE_KV.get(`name_${userId}`);
                name = savedName || env.ADMIN_NAME || tgName;
                alreadyRegistered = savedName !== null;
                telegramName = tgName;
                username = query.from.username ? `@${query.from.username}` : "-";
            } else {
                // Get saved pending registration data
                const pendingRaw = await env.ATTENDANCE_KV.get(`reg_pending_${userId}`);
                if (!pendingRaw) {
                    // Pending data expired — ask to register again
                    await editMessageWithKeyboard(chatId, messageId,
                        `❌ *Registration expired.*\n\nPlease type /start and try again.`,
                        { inline_keyboard: [] },
                        env.BOT_TOKEN
                    );
                    return;
                }
                ({ name, alreadyRegistered, telegramName, username } = JSON.parse(pendingRaw));
                await env.ATTENDANCE_KV.delete(`reg_pending_${userId}`); // Clean up pending
            }

            // Save all registration data to KV
            await env.ATTENDANCE_KV.put(`name_${userId}`, name);
            await env.ATTENDANCE_KV.put(`approved_${userId}`, "true");
            await env.ATTENDANCE_KV.put(`group_${userId}`, groupLabel);

            // Build the home screen for the newly registered user
            const homeScreen = await buildHomeScreen(userId, env);

            // Edit current message to show welcome + home
            await editMessageWithKeyboard(chatId, messageId,
                `✅ ${alreadyRegistered ? "Updated" : "Welcome"}, *${name}*! 🙏\n\nGroup: *${groupLabel}*\n\n` + homeScreen.text,
                homeScreen.keyboard,
                env.BOT_TOKEN
            );

            // Save this as the main message ID
            await saveMainMessageId(userId, messageId, env);

            // Update sheet (awaited — un-awaited fetches get cancelled when the Worker returns)
            await appendToSheet(name, telegramName, username, groupLabel, userId, env);

            // Only notify admin for brand new members
            if (!alreadyRegistered) {
                await notifyAdmin(name, telegramName, username, groupLabel, userId, env);
            }
            
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

    if (!text) return;

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
                if (text === env.INVITE_CODE) {
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

                const groupScreen = buildGroupPickerScreen(text);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    groupScreen.text,
                    groupScreen.keyboard,
                    env.BOT_TOKEN
                );

            } else if (inputPending === "update_name") {
                // User typed new name from profile screen
                await env.ATTENDANCE_KV.put(`name_${userId}`, text);
                const screen = await buildProfileScreen(userId, env);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `✅ *Name updated to ${text}!*\n\n` + screen.text,
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
                        `✅ *${name}*, you are now logged in as *LEADER*!\n\n` + screen.text,
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
                        `✅ *${name}*, you are now logged in as *ADMIN*!\n\n` + screen.text,
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
                await env.ATTENDANCE_KV.put(`input_pending_${userId}`, "new_event_when", { expirationTtl: 300 });
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `🕐 *${text}*\n\nType the date & time in one go:\n\nExample: \`Fri 17 Oct, 5:30pm\``,
                    { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "screen_events" }]] },
                    env.BOT_TOKEN
                );

            } else if (inputPending === "new_event_when") {
                // Admin typed date & time — now ask for location (or skip)
                const name = await env.ATTENDANCE_KV.get(`new_event_pending_${userId}`);
                if (!name) {
                    const screen = await buildEventsScreen(env);
                    await editMessageWithKeyboard(chatId, mainMsgId, `❌ Expired. Please add the event again.\n\n` + screen.text, screen.keyboard, env.BOT_TOKEN);
                    return;
                }
                await env.ATTENDANCE_KV.put(`new_event_pending_${userId}`, JSON.stringify({ name, when: text }), { expirationTtl: 300 });
                await env.ATTENDANCE_KV.put(`input_pending_${userId}`, "new_event_location", { expirationTtl: 300 });
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `📍 *${name}* — ${text}\n\nType the location:\n\nExample: \`SP Chapel\``,
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

            } else if (inputPending === "add_member_name") {
                // Leader typed new non-telegram member name
                // Save name temporarily, show group picker
                await env.ATTENDANCE_KV.put(`add_member_pending_${userId}`, text, { expirationTtl: 300 });
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `👥 *Select group for ${text}:*`,
                    {
                        inline_keyboard: [
                            [{ text: "Refresher", callback_data: "add_member_group_refresher" }],
                            [{ text: "Rescuer", callback_data: "add_member_group_rescuer" }],
                            [{ text: "Repairer", callback_data: "add_member_group_repairer" }],
                            [{ text: "Rebuilder", callback_data: "add_member_group_rebuilder" }],
                            [{ text: "Recharger", callback_data: "add_member_group_recharger" }],
                            [{ text: "❌ Cancel", callback_data: "screen_manage_members" }]
                        ]
                    },
                    env.BOT_TOKEN
                );
            }
            
            return; // ✅ Done — stop processing
        }

        // Not waiting for any input — ignore non-command text
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