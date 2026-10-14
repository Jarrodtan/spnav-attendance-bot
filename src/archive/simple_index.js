// ============================================
// SP NAVIGATORS ATTENDANCE BOT
// simple_index.js — Interactive Single-Message Version
// ============================================
//
// HOW THIS VERSION WORKS:
//   - Only ONE persistent message in chat (the "main screen")
//   - Everything is buttons — no slash commands needed
//   - Main message gets EDITED when user taps buttons
//   - Text input only when absolutely needed (invite code, name, password, admin settings)
//   - Sensitive text (passwords, invite codes, names) are DELETED from chat immediately
//   - Registration still required for security (invite code gated)
//
// Cloudflare Environment Variables needed:
//   BOT_TOKEN       — Telegram bot token
//   ADMIN_USER_ID   — Your Telegram user ID (number)
//   ADMIN_NAME      — Your display name (optional, falls back to Telegram name)
//   ADMIN_PASSWORD  — Admin login password
//   LEADER_PASSWORD — Leader login password
//   INVITE_CODE     — Invite code for new members
//   APPS_SCRIPT_URL — Google Apps Script URL for Google Sheets
//
// KV Namespace binding: ATTENDANCE_KV
//
// KV Keys used:
//   name_{userId}           — Member's registered name
//   approved_{userId}       — Whether user is approved ("true")
//   role_{userId}           — User role ("member", "leader", "admin")
//   group_{userId}          — Ministry group name
//   rsvp_{userId}           — RSVP status ("coming", "notcoming")
//   main_msg_{userId}       — The persistent message ID to edit
//   input_pending_{userId}  — What text input we're waiting for ("invite_code", "name", "password_leader", "password_admin", "set_name", "set_date", "set_time")
//   reg_pending_{userId}    — Temporary registration data while waiting for group selection (JSON)
//   event_name              — Current event name
//   event_date              — Current event date (overrides auto)
//   event_time              — Current event time
//   event_active            — "false" if cancelled
//   event_mode              — "normal", "standdown", "holiday"
// ============================================


// ============================================
// DATE HELPER
// ============================================
function getThisFriday() {
    // Returns the date of this coming Friday
    // If today IS Friday, returns today
    const today = new Date();
    const day = today.getDay(); // 0=Sun, 6=Sat
    let diff;
    if (day === 0) diff = 5;       // Sunday → next Friday in 5 days
    else if (day === 6) diff = 6;  // Saturday → next Friday in 6 days
    else diff = 5 - day;           // Mon-Fri → this Friday (diff=0 on Friday)
    const friday = new Date(today);
    friday.setDate(today.getDate() + diff);
    const d = friday.getDate();
    const m = friday.toLocaleString('en-US', { month: 'long' });
    const y = friday.getFullYear();
    return `${d} ${m} ${y} (Fri)`;
}


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

async function getEventName(env) {
    return await env.ATTENDANCE_KV.get("event_name") || "Weekly Nav+U" || "Vacation Training Programme" || "Prayer Walk";
}

async function getEventDate(env) {
    // Use manual override if set, otherwise auto-calculate this Friday
    return await env.ATTENDANCE_KV.get("event_date") || getThisFriday();
}

async function getEventTime(env) {
    return await env.ATTENDANCE_KV.get("event_time") || "5:30pm";
}

async function isEventActive(env) {
    const val = await env.ATTENDANCE_KV.get("event_active");
    return val !== "false"; // Default is active
}

// Get event mode: "normal", "standdown", "holiday"
async function getEventMode(env) {
    return await env.ATTENDANCE_KV.get("event_mode") || "normal";
}

// Returns the full event string based on current mode
async function getEventFull(env) {
    const mode = await getEventMode(env);
    const date = await getEventDate(env);
    const time = await getEventTime(env);

    if (mode === "standdown") {
        // CCA standdown — show Prayer Walk
        const name = await env.ATTENDANCE_KV.get("event_name") || "Prayer Walk";
        return `${name} on ${date} at ${time}`;
    } else if (mode === "holiday") {
        // No activity during holidays
        return `No activities`;
    } else {
        // Normal week
        const name = await env.ATTENDANCE_KV.get("event_name") || "Weekly Nav+U";
        return `${name} on ${date} at ${time}`;
    }
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
async function buildHomeScreen(userId, env) {
    const name = await getName(userId, env);
    const role = await getRole(userId, env);
    const mode = await getEventMode(env);
    const active = await isEventActive(env);
    const event = await getEventFull(env);

    const status = await env.ATTENDANCE_KV.get(`rsvp_${userId}`);

    // Build status - response
    let statusText = "";
    if (mode === "holiday") {
        statusText = `🏖️ No activity this week.`;
    } else if (!active) {
        statusText = `❌ Event has been cancelled.`;
    } else if (status === "coming") {
        statusText = `✅ You are *COMING*`;
    } else if (status === "notcoming") {
        statusText = `❌ You are *NOT COMING*`;
    } else {
        statusText = `❓ You haven't RSVP'd yet.\n\nTap RSVP to respond!\n\n`;
    }

    // Build status line based on mode
    let statusLine = "";
    if (mode === "holiday") {
        statusLine = `🏖️ *No activities*`;
    } else if (mode === "standdown") {
        statusLine = `🙏 *CCA Stand Down Week*\n📅 ${event}`;
    } else if (!active) {
        statusLine = `❌ *Event cancelled* — Check with leaders`;
    } else {
        statusLine = `📅 ${event}`;
    }

    const text = `🙏 *Welcome, ${name}!*\n\n${statusLine}\n\n📊 My Status: ${statusText}\n\n_Tap a button below:_`;

    // Build buttons based on role
    const keyboard = { inline_keyboard: [] };

    // Member buttons (everyone sees these)
    keyboard.inline_keyboard.push([
        { text: "📋 RSVP", callback_data: "screen_rsvp" },
        { text: "👤 My Profile", callback_data: "screen_profile" }
    ]);
    // keyboard.inline_keyboard.push([
    //     { text: "📋 RSVP", callback_data: "screen_rsvp" },
    //     { text: "📊 My Status", callback_data: "screen_status" }
    // ]);
    // keyboard.inline_keyboard.push([
    //     { text: "👤 My Profile", callback_data: "screen_profile" }
    // ]);

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
            { text: "⚙️ Event Settings", callback_data: "screen_event_settings" },
            { text: "🔄 Week Mode", callback_data: "screen_week_mode" }
        ]);
        keyboard.inline_keyboard.push([
            { text: "👥 Members", callback_data: "screen_members" },
            { text: "🗑️ Clear RSVPs", callback_data: "action_clear" }
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

// RSVP SCREEN
async function buildRsvpScreen(userId, env) {
    const name = await getName(userId, env);
    const active = await isEventActive(env);
    const event = await getEventFull(env);
    const mode = await getEventMode(env);

    // Block RSVP if cancelled or holiday
    if (!active || mode === "holiday") {
        return {
            text: `❌ *RSVP Unavailable*\n\n${mode === "holiday" ? "No activities." : "Event has been cancelled."}\n\nCheck with your leaders for updates.`,
            keyboard: { inline_keyboard: [[{ text: "🔙 Back to Home", callback_data: "screen_home" }]] }
        };
    }

    return {
        text: `📋 *RSVP*\n\n📅 ${event}\n\nAre you coming, *${name}*?`,
        keyboard: {
            inline_keyboard: [
                [
                    { text: "✅ Coming", callback_data: "action_rsvp_yes" },
                    { text: "❌ Not Coming", callback_data: "action_rsvp_no" }
                ],
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// STATUS SCREEN
// async function buildStatusScreen(userId, env) {
//     const name = await getName(userId, env);
//     const event = await getEventFull(env);
//     const active = await isEventActive(env);
//     const status = await env.ATTENDANCE_KV.get(`rsvp_${userId}`);
//     const mode = await getEventMode(env);

//     let statusText = "";
//     if (mode === "holiday") {
//         statusText = `🏖️ No activity this week.`;
//     } else if (!active) {
//         statusText = `❌ Event has been cancelled.`;
//     } else if (status === "coming") {
//         statusText = `✅ You are *COMING*`;
//     } else if (status === "notcoming") {
//         statusText = `❌ You are *NOT COMING*`;
//     } else {
//         statusText = `❓ You haven't RSVP'd yet.\n\nTap RSVP to respond!`;
//     }

//     return {
//         text: `📊 *My Status*\n\n📅 ${event}\n\n${statusText}`,
//         keyboard: {
//             inline_keyboard: [
//                 [{ text: "📋 RSVP Now", callback_data: "screen_rsvp" }],
//                 [{ text: "🔙 Back", callback_data: "screen_home" }]
//             ]
//         }
//     };
// }

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

// LIST SCREEN (Leaders only)
async function buildListScreen(env) {
    const event = await getEventFull(env);
    const active = await isEventActive(env);
    const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
    const coming = [], notcoming = [];

    for (const key of list.keys) {
        const status = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("rsvp_", "");
        const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
        // Show ID for Telegram users, not for non-telegram members
        const isNonTele = memberId.startsWith("nontelegram:");
        const label = isNonTele ? memberName : `${memberName} (${memberId})`;
        if (status === "coming") coming.push(label);
        else if (status === "notcoming") notcoming.push(label);
    }

    const activeTag = active ? "" : " *(cancelled)*";
    const text = `📋 *Attendance List*${activeTag}\n\n📅 ${event}\n\n✅ *Coming (${coming.length}):*\n${coming.map(n => `• ${n}`).join("\n") || "• None"}\n\n❌ *Not Coming (${notcoming.length}):*\n${notcoming.map(n => `• ${n}`).join("\n") || "• None"}`;

    return {
        text,
        keyboard: {
            inline_keyboard: [
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
    };
}

// WHATSAPP SCREEN (Leaders only)
async function buildWhatsappScreen(env) {
    const name = await getEventName(env);
    const date = await getEventDate(env);
    const time = await getEventTime(env);
    const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
    const coming = [], notcoming = [];

    for (const key of list.keys) {
        const status = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("rsvp_", "");
        const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
        if (status === "coming") coming.push(memberName);
        else if (status === "notcoming") notcoming.push(memberName);
    }

    let msg = `*《SP NAVIGATORS ATTENDANCE》*\n\n`;
    msg += `📅 *${name}*\n🗓 ${date}  🕐 ${time}\n\n`;
    msg += `✅ *COMING (${coming.length})*\n`;
    coming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
    if (coming.length === 0) msg += `None\n`;
    msg += `\n❌ *NOT COMING (${notcoming.length})*\n`;
    notcoming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
    if (notcoming.length === 0) msg += `None\n`;

    return {
        text: msg,
        keyboard: {
            inline_keyboard: [
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
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

// MARK ATTENDANCE SCREEN (Leaders only)
async function buildMarkAttendanceScreen(env) {
    // Get all non-telegram members
    const list = await env.ATTENDANCE_KV.list({ prefix: "name_nontelegram:" });
    
    if (list.keys.length === 0) {
        return {
            text: `📋 *Mark Attendance*\n\nNo non-Telegram members found.\n\nAdd members first using ➕ Add Member.`,
            keyboard: {
                inline_keyboard: [
                    [{ text: "➕ Add Member", callback_data: "input_add_member_name" }],
                    [{ text: "🔙 Back", callback_data: "screen_manage_members" }]
                ]
            }
        };
    }

    // Build one button per member
    const buttons = [];
    for (const key of list.keys) {
        const memberName = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("name_", "");
        const status = await env.ATTENDANCE_KV.get(`rsvp_${memberId}`);
        const statusIcon = status === "coming" ? "✅" : status === "notcoming" ? "❌" : "❓";
        buttons.push([{
            text: `${statusIcon} ${memberName}`,
            callback_data: `mark_member_${memberId}`
        }]);
    }
    buttons.push([{ text: "🔙 Back", callback_data: "screen_manage_members" }]);

    return {
        text: `📋 *Mark Attendance*\n\nTap a member to update their RSVP:\n\n✅ Coming  ❌ Not Coming  ❓ No response`,
        keyboard: { inline_keyboard: buttons }
    };
}

// EVENT SETTINGS SCREEN (Admin only)
async function buildEventSettingsScreen(env) {
    const event = await getEventFull(env);
    return {
        text: `⚙️ *Event Settings*\n\n📅 *Current:* ${event}\n\n_Tap to change:_`,
        keyboard: {
            inline_keyboard: [
                [
                    { text: "✏️ Name", callback_data: "input_set_name" },
                    { text: "📅 Date", callback_data: "input_set_date" },
                    { text: "⏰ Time", callback_data: "input_set_time" }
                ],
                [{ text: "🗓 Auto Date (This Friday)", callback_data: "action_autodate" }],
                [
                    { text: "❌ Cancel Event", callback_data: "action_cancel_event" },
                    { text: "✅ Activate Event", callback_data: "action_activate_event" }
                ],
                [{ text: "🔙 Back", callback_data: "screen_home" }]
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

// WEEK MODE SCREEN (Admin only)
async function buildWeekModeScreen(env) {
    const mode = await getEventMode(env);
    const modeLabel = mode === "standdown" ? "🙏 Stand Down" : mode === "holiday" ? "🏖️ Holiday" : "📖 Normal Week";

    return {
        text: `🔄 *Week Mode*\n\n*Current mode:* ${modeLabel}\n\n_Select the mode for this week:_`,
        keyboard: {
            inline_keyboard: [
                [{ text: "📖 Normal Week (Nav+U)", callback_data: "action_mode_normal" }],
                [{ text: "🙏 CCA Stand Down (Prayer Walk)", callback_data: "action_mode_standdown" }],
                [{ text: "🏖️ No Activities", callback_data: "action_mode_holiday" }],
                [{ text: "🔙 Back", callback_data: "screen_home" }]
            ]
        }
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

        } else if (data === "screen_rsvp") {
            // Go to RSVP screen
            const screen = await buildRsvpScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        // } else if (data === "screen_status") {
        //     // Go to status screen
        //     const screen = await buildStatusScreen(userId, env);
        //     await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
        //     return;

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

        } else if (data === "screen_event_settings") {
            // Go to event settings (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Admin only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = await buildEventSettingsScreen(env);
            await editMessageWithKeyboard(chatId, messageId, screen.text, screen.keyboard, env.BOT_TOKEN);
            return;

        } else if (data === "screen_week_mode") {
            // Go to week mode screen (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ Admin only.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            const screen = await buildWeekModeScreen(env);
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

        } else if (data === "input_set_name") {
            // Ask admin to type new event name
            await promptInput(userId, chatId, messageId, "set_name",
                `✏️ *Set Event Name*\n\nPlease type the new event name:\n\nExample: \`Weekly Nav+U\``,
                env
            );
            return;

        } else if (data === "input_set_date") {
            // Ask admin to type new event date
            await promptInput(userId, chatId, messageId, "set_date",
                `📅 *Set Event Date*\n\nPlease type the new event date:\n\nExample: \`5 September 2026 (Fri)\``,
                env
            );
            return;

        } else if (data === "input_set_time") {
            // Ask admin to type new event time
            await promptInput(userId, chatId, messageId, "set_time",
                `⏰ *Set Event Time*\n\nPlease type the new event time:\n\nExample: \`5:30pm\``,
                env
            );
            return;

        // ===== ACTION BUTTONS =====
        // These perform an action and return to a screen

        } else if (data === "action_rsvp_yes") {
            // Mark as coming
            const active = await isEventActive(env);
            const mode = await getEventMode(env);
            if (!active || mode === "holiday") {
                await editMessageWithKeyboard(chatId, messageId,
                    `❌ *Cannot RSVP* — Event is not active.`,
                    { inline_keyboard: [[{ text: "🔙 Back", callback_data: "screen_home" }]] },
                    env.BOT_TOKEN
                );
                return;
            }
            await env.ATTENDANCE_KV.put(`rsvp_${userId}`, "coming");
            const event = await getEventFull(env);
            const name = await getName(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *RSVP Confirmed!*\n\n*${name}*, you are marked as *COMING* to:\n📅 ${event}\n\nSee you there! 🙏`,
                { inline_keyboard: [
                    [{ text: "🔙 Back to Home", callback_data: "screen_home" }]
                ]},
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_rsvp_no") {
            // Mark as not coming
            await env.ATTENDANCE_KV.put(`rsvp_${userId}`, "notcoming");
            const event = await getEventFull(env);
            const name = await getName(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `❌ *RSVP Noted!*\n\n*${name}*, you are marked as *NOT COMING* to:\n📅 ${event}\n\nWe'll miss you! 🙏`,
                { inline_keyboard: [
                    [{ text: "🔙 Back to Home", callback_data: "screen_home" }]
                ]},
                env.BOT_TOKEN
            );
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

        } else if (data === "action_autodate") {
            // Reset event date to auto (this Friday)
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.delete("event_date");
            const screen = await buildEventSettingsScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ Date reset to auto: *${getThisFriday()}*\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_cancel_event") {
            // Cancel the event
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.put("event_active", "false");
            const screen = await buildEventSettingsScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `❌ *Event cancelled.*\n\nMembers will see a notice.\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_activate_event") {
            // Activate/reactivate the event
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.put("event_active", "true");
            const screen = await buildEventSettingsScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *Event activated!*\n\nMembers can now RSVP.\n\n` + screen.text,
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

        } else if (data === "action_clear") {
            // Clear all RSVPs (admin only)
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
            for (const key of list.keys) {
                await env.ATTENDANCE_KV.delete(key.name);
            }
            const screen = await buildHomeScreen(userId, env);
            await editMessageWithKeyboard(chatId, messageId,
                `🗑️ *All RSVPs cleared!* Ready for a new week.\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_mode_normal") {
            // Set to normal Nav+U week
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.put("event_mode", "normal");
            await env.ATTENDANCE_KV.put("event_name", "Weekly Nav+U");
            await env.ATTENDANCE_KV.put("event_active", "true");
            const screen = await buildWeekModeScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `✅ *Normal week set!* — Weekly Nav+U\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_mode_standdown") {
            // Set to CCA standdown / Prayer Walk week
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.put("event_mode", "standdown");
            await env.ATTENDANCE_KV.put("event_name", "Prayer Walk");
            await env.ATTENDANCE_KV.put("event_active", "true");
            const screen = await buildWeekModeScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `🙏 *Stand Down mode set!* — Prayer Walk\n\n` + screen.text,
                screen.keyboard,
                env.BOT_TOKEN
            );
            return;

        } else if (data === "action_mode_holiday") {
            // Set to holiday / VTP break week
            const admin = await isAdmin(userId, env);
            if (!admin) return;
            await env.ATTENDANCE_KV.put("event_mode", "holiday");
            await env.ATTENDANCE_KV.put("event_active", "false");
            const screen = await buildWeekModeScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `🏖️ *Holiday mode set!* — No Friday activity.\n\n` + screen.text,
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
            const screen = await buildMarkAttendanceScreen(env);
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

        } else if (data.startsWith("mark_member_")) {
            // Leader tapped a member — show Coming/Not Coming buttons
            const leader = await isLeader(userId, env);
            if (!leader) return;
            const memberId = data.replace("mark_member_", "");
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            const currentStatus = await env.ATTENDANCE_KV.get(`rsvp_${memberId}`);
            const statusText = currentStatus === "coming" ? "✅ Currently: Coming"
                : currentStatus === "notcoming" ? "❌ Currently: Not Coming"
                : "❓ Currently: No response";
            await editMessageWithKeyboard(chatId, messageId,
                `📋 *Mark Attendance*\n\n*${memberName}*\n${statusText}\n\nUpdate to:`,
                { inline_keyboard: [
                    [
                        { text: "✅ Coming", callback_data: `set_att_coming_${memberId}` },
                        { text: "❌ Not Coming", callback_data: `set_att_notcoming_${memberId}` }
                    ],
                    [{ text: "🔙 Back", callback_data: "screen_mark_attendance" }]
                ]},
                env.BOT_TOKEN
            );
            return;

        } else if (data.startsWith("set_att_")) {
            // Set attendance for a non-telegram member
            const leader = await isLeader(userId, env);
            if (!leader) return;
            // Format: set_att_coming_nontelegram:James Wong
            const withoutPrefix = data.replace("set_att_", "");
            const firstUnder = withoutPrefix.indexOf("_");
            const status = withoutPrefix.substring(0, firstUnder); // "coming" or "notcoming"
            const memberId = withoutPrefix.substring(firstUnder + 1); // "nontelegram:James Wong"
            const memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`) || memberId;
            await env.ATTENDANCE_KV.put(`rsvp_${memberId}`, status);
            const statusLabel = status === "coming" ? "✅ COMING" : "❌ NOT COMING";
            const screen = await buildMarkAttendanceScreen(env);
            await editMessageWithKeyboard(chatId, messageId,
                `${statusLabel}\n\n*${memberName}* marked as *${status === "coming" ? "Coming" : "Not Coming"}*\n\n` + screen.text,
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
            for (const prefix of ["name_", "rsvp_", "group_", "approved_", "role_", "main_msg_"]) {
                await env.ATTENDANCE_KV.delete(`${prefix}${memberId}`);
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

            } else if (inputPending === "set_name") {
                // Admin typed new event name
                await env.ATTENDANCE_KV.put("event_name", text);
                const screen = await buildEventSettingsScreen(env);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `✅ *Event name updated to: ${text}*\n\n` + screen.text,
                    screen.keyboard,
                    env.BOT_TOKEN
                );

            } else if (inputPending === "set_date") {
                // Admin typed new event date
                await env.ATTENDANCE_KV.put("event_date", text);
                const screen = await buildEventSettingsScreen(env);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `✅ *Event date updated to: ${text}*\n\n` + screen.text,
                    screen.keyboard,
                    env.BOT_TOKEN
                );

            } else if (inputPending === "set_time") {
                // Admin typed new event time
                await env.ATTENDANCE_KV.put("event_time", text);
                const screen = await buildEventSettingsScreen(env);
                await editMessageWithKeyboard(chatId, mainMsgId,
                    `✅ *Event time updated to: ${text}*\n\n` + screen.text,
                    screen.keyboard,
                    env.BOT_TOKEN
                );

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