// ============================================
// SP NAVIGATORS ATTENDANCE BOT
// index.js — Full Version
// ============================================
//
// Cloudflare Environment Variables needed:
//   BOT_TOKEN       — Telegram bot token
//   ADMIN_USER_ID   — Your Telegram user ID
//   ADMIN_PASSWORD  — Admin login password
//   LEADER_PASSWORD — Leader login password
//   INVITE_CODE     — Invite code for new members
//
// KV Namespace binding: ATTENDANCE_KV
// ============================================
 
// ============================================
// STEP 1 — DATE HELPER
// ============================================
function getThisFriday() {
    const today = new Date();
    const day = today.getDay(); // 0=Sun, 6=Sat
    let diff;
    if (day === 0) diff = 5;       // Sunday → +5
    else if (day === 6) diff = 6;  // Saturday → +6
    else diff = 5 - day;           // Mon-Fri → this Friday
    const friday = new Date(today);
    friday.setDate(today.getDate() + diff);
    const d = friday.getDate();
    const m = friday.toLocaleString('en-US', { month: 'long' });
    const y = friday.getFullYear();
    return `${d} ${m} ${y} (Fri)`;
}

// ============================================
// STEP 1 — TELEGRAM HELPERS
// ============================================
async function sendMessage(chatId, text, token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
}
 
async function sendKeyboard(chatId, text, keyboard, token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
            reply_markup: keyboard
        })
    });
}
 
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

// ============================================
// STEP 3 — KEYBOARDS
// ============================================
function loginKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "🔐 Login as Leader", callback_data: "login_leader" }],
            [{ text: "🔐 Login as Admin", callback_data: "login_admin" }],
            // [{ text: "❌ Logout", callback_data: "logout" }]
        ]
    };
}

// ============================================
// STEP 5 — RSVP KEYBOARD
// ============================================
function rsvpKeyboard() {
    return {
        inline_keyboard: [[
            { text: "✅ Coming", callback_data: "rsvp_yes" },
            { text: "❌ Not Coming", callback_data: "rsvp_no" }
        ]]
    };
}

// ============================================
// STEP 5 — Ministry Group KEYBOARD
// ============================================
function ministryGroupKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "Refresher", callback_data: "group_refresher" }],
            [{ text: "Rescuer", callback_data: "group_rescuer" }],
            [{ text: "Repairer", callback_data: "group_repairer" }],
            [{ text: "Rebuilder", callback_data: "group_rebuilder" }],
            [{ text: "Recharger", callback_data: "group_recharger" }]
        ]
    };
}

// ============================================
// STEP 2 — USER HELPERS
// ============================================
async function getName(userId, env) {
    const name = await env.ATTENDANCE_KV.get(`name_${userId}`);
    return name || "Member";
}
 
async function isApproved(userId, env) {
    const val = await env.ATTENDANCE_KV.get(`approved_${userId}`);
    return val === "true";
}

// ============================================
// STEP 3 — ROLE HELPERS
// ============================================
async function getRole(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role || "member";
}
 
async function isLeader(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role === "leader" || role === "admin";
}
 
async function isAdmin(userId, env) {
    const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
    return role === "admin";
}

// ============================================
// STEP 4 — EVENT HELPERS
// ============================================
async function getEventName(env) {
    return await env.ATTENDANCE_KV.get("event_name") || "Weekly Nav+U";
}
 
async function getEventDate(env) {
    return await env.ATTENDANCE_KV.get("event_date") || getThisFriday();
}
 
async function getEventTime(env) {
    return await env.ATTENDANCE_KV.get("event_time") || "5:30pm";
}
 
async function isEventActive(env) {
    const val = await env.ATTENDANCE_KV.get("event_active");
    return val !== "false";
}

async function getEventMode(env) {
    // Modes: "normal", "standdown", "holiday"
    return await env.ATTENDANCE_KV.get("event_mode") || "normal";
}

async function getEventFull(env) {
    const mode = await getEventMode(env);
    const date = await getEventDate(env);
    const time = await getEventTime(env);

    if (mode === "standdown") {
        const name = await env.ATTENDANCE_KV.get("event_name") || "Prayer Walk";
        return `${name} on ${date} at ${time}`;
    } else if (mode === "holiday") {
        return `No Friday activity — Holiday / VTP Break`;
    } else {
        const name = await env.ATTENDANCE_KV.get("event_name") || "Weekly Nav+U";
        return `${name} on ${date} at ${time}`;
    }
}

// ============================================
// GOOGLE SHEETS VIA APPS SCRIPT
// ============================================
async function appendToSheet(name, telegramName, username, ministryGroup, userId, env) {
    if (!env.APPS_SCRIPT_URL) return;
    try {
        await fetch(env.APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: name,
                telegram: telegramName,
                username: username,
                group: ministryGroup,
                userId: userId.toString()
            })
        });
    } catch (err) {
        console.error("Apps Script error:", err);
        // Fail silently — don't break the bot
    }
}

// ============================================
// STEP 2 — ADMIN NOTIFICATION ON REGISTER
// ============================================
async function notifyAdmin(name, telegramName, username, ministryGroup, userId, env) {
    if (!env.ADMIN_USER_ID) return;

    // Telegram notification
    await sendMessage(
        parseInt(env.ADMIN_USER_ID),
        `🔔 *New member registered!*\n\nName: *${name}*\nTele Display Name: ${telegramName}\nTele Username: ${username}\nUser ID: \`${userId}\``,
        env.BOT_TOKEN
    );

    // Save to Google Sheet
    await appendToSheet(name, telegramName, username, ministryGroup, userId, env);
}

// ============================================
// STEP 1 — MAIN REQUEST HANDLER
// ============================================
async function handleRequest(request, env) {
    const url = new URL(request.url);
 
    if (url.pathname === `/webhook/${env.BOT_TOKEN}` && request.method === "POST") {
        const update = await request.json();
        await handleUpdate(update, env);
        return new Response("OK");
    }
 
    if (url.pathname === "/setup") {
        return new Response(
            `Visit this URL to set your webhook:\n\nhttps://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${url.origin}/webhook/${env.BOT_TOKEN}`
        );
    }
 
    return new Response("SP Navigators Bot is running! ✅");
}
 
// ============================================
// MAIN UPDATE HANDLER
// ============================================
async function handleUpdate(update, env) {
 
    // ==========================================
    // STEP 3 & 5 — HANDLE BUTTON CLICKS
    // ==========================================
    if (update.callback_query) {
        const query = update.callback_query;
 
        // Always answer callback to remove loading spinner
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: query.id })
        });
 
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const name = await getName(userId, env);
        let response = "";
 
        // ===== STEP 3 — Login buttons =====
        if (data === "login_leader") {
            await env.ATTENDANCE_KV.put(`login_pending_${userId}`, "leader");
            response = `🔐 Please type the *leader password*:`;

            // Replace buttons with result
            await editMessage(chatId, messageId, response, env.BOT_TOKEN);
            return;
 
        } else if (data === "login_admin") {
            await env.ATTENDANCE_KV.put(`login_pending_${userId}`, "admin");
            response = `🔐 Please type the *admin password*:`;

            // Replace buttons with result
            await editMessage(chatId, messageId, response, env.BOT_TOKEN);
            return;
 
        // ===== STEP 5 — RSVP buttons =====
        } else if (data === "rsvp_yes") {
            const active = await isEventActive(env);
            if (!active) {
                response = `❌ Sorry, this event has been *cancelled*.\n\nYou cannot RSVP. Check with your leaders.`;
            } else {
                await env.ATTENDANCE_KV.put(`rsvp_${userId}`, "coming");
                const event = await getEventFull(env);
                response = `✅ Great, *${name}*!\n\nYou are marked as *COMING* to:\n📅 ${event}\n\nSee you there! 🙏`;
            }
            // Replace buttons with result
            await editMessage(chatId, messageId, response, env.BOT_TOKEN);
            return;
 
        } else if (data === "rsvp_no") {
            const active = await isEventActive(env);
            if (!active) {
                response = `❌ This event has been *cancelled*.`;
            } else {
                await env.ATTENDANCE_KV.put(`rsvp_${userId}`, "notcoming");
                const event = await getEventFull(env);
                response = `❌ Noted, *${name}*!\n\nYou are marked as *NOT COMING* to:\n📅 ${event}\n\nWe'll miss you! 🙏`;
            }
            // Replace buttons with result
            await editMessage(chatId, messageId, response, env.BOT_TOKEN);
            return;
        } else if (data.startsWith("group_")) {
            const group = data.replace("group_", "");
            const groupLabel = group.charAt(0).toUpperCase() + group.slice(1);

            // Get pending registration data
            const pendingRaw = await env.ATTENDANCE_KV.get(`reg_pending_${userId}`);
            if (!pendingRaw) {
                response = `❌ Registration expired.\n\nPlease try /register again.`;
                await editMessage(chatId, messageId, response, env.BOT_TOKEN);
                return;
            }

            const { name: regName, alreadyRegistered, telegramName, username } = JSON.parse(pendingRaw);
            await env.ATTENDANCE_KV.delete(`reg_pending_${userId}`);

            // ✅ Now save everything after group is selected
            await env.ATTENDANCE_KV.put(`name_${userId}`, regName);
            await env.ATTENDANCE_KV.put(`approved_${userId}`, "true");
            await env.ATTENDANCE_KV.put(`group_${userId}`, groupLabel);

            if (alreadyRegistered) {
                response = `✅ Updated, *${regName}*! 🙏\n\nGroup: *${groupLabel}*\n\nUse /rsvp to RSVP for the next event.`;
                await appendToSheet(regName, telegramName, username, groupLabel, userId, env);
            } else {
                response = `✅ Welcome, *${regName}*! 🙏\n\nGroup: *${groupLabel}*\n\nYou are now registered.\n\nUse /rsvp to RSVP for the next event.`;
                await notifyAdmin(regName, telegramName, username, groupLabel, userId, env);
            }

            await editMessage(chatId, messageId, response, env.BOT_TOKEN);
            return;
        }


        if (response) await sendMessage(chatId, response, env.BOT_TOKEN);
        return;
    }
 
    // ==========================================
    // TEXT MESSAGE HANDLER
    // ==========================================
    if (!update.message) return;
 
    const chatId = update.message.chat.id;
    const text = update.message.text;
    const userId = update.message.from.id;
    const firstName = update.message.from.first_name || "";
    const lastName = update.message.from.last_name || "";
    const telegramName = lastName ? `${firstName} ${lastName}` : firstName;
    const username = update.message.from.username ? `@${update.message.from.username}` : "-";
 
    if (!text) return;
 
    // ==========================================
    // STEP 2 — AUTO APPROVE CREATOR (Admin)
    // ==========================================
    const isCreator = userId === parseInt(env.ADMIN_USER_ID);
    if (isCreator) {
        await env.ATTENDANCE_KV.put(`approved_${userId}`, "true");
        const existingName = await env.ATTENDANCE_KV.get(`name_${userId}`);
        if (!existingName) {
            const adminName = env.ADMIN_NAME || telegramName;
            await env.ATTENDANCE_KV.put(`name_${userId}`, adminName);
        }
    }
 
    const approved = await isApproved(userId, env);
 
    // ==========================================
    // STEP 3 — PASSWORD INPUT HANDLER
    // ==========================================
    if (!text.startsWith("/")) {
        const pending = await env.ATTENDANCE_KV.get(`login_pending_${userId}`);
        if (pending) {
            await env.ATTENDANCE_KV.delete(`login_pending_${userId}`);
            const name = await getName(userId, env);
            let response = "";
            if (pending === "admin") {
                if (text === env.ADMIN_PASSWORD) {
                    await env.ATTENDANCE_KV.put(`role_${userId}`, "admin");
                    response = `✅ *${name}*, you are now logged in as *ADMIN*!\n\nType /start to see the full menu.`;
                } else {
                    response = `❌ Wrong admin password.\n\nTry /login again.`;
                }
            } else if (pending === "leader") {
                if (text === env.LEADER_PASSWORD) {
                    await env.ATTENDANCE_KV.put(`role_${userId}`, "leader");
                    response = `✅ *${name}*, you are now logged in as *LEADER*!\n\nType /start to see the full menu.`;
                } else {
                    response = `❌ Wrong leader password.\n\nTry /login again.`;
                }
            }
            await sendMessage(chatId, response, env.BOT_TOKEN);
            return; // ✅ Stop here — don't fall through
        }
        // Ignore all other non-command text
        return;
    }
 
    // ==========================================
    // STEP 2 — BLOCK UNAPPROVED USERS
    // Only /start and /register work for strangers
    // ==========================================
    if (!approved && !isCreator) {
        if (text === "/start") {
            // await sendMessage(chatId,
            //     `🙏 Welcome to *SP Navigators* Attendance Bot!\n\nThis bot is for SP Navigators members only.\n\nIf you have an invite code:\n\`/register [Your Name] [Invite Code]\`\n\nOtherwise contact your leader to get started.`,
            //     env.BOT_TOKEN
            // );
        } else if (text.startsWith("/register")) {
            // Fall through to register handler below
        } else {
            // Silently ignore everything else from strangers
            return;
        }
    }
 
    let response = "";
 
    // ==========================================
    // STEP 2 — /register
    // ==========================================
    if (text.startsWith("/register")) {
        const args = text.substring(9).trim();
 
        // Check if already registered
        const getName = await env.ATTENDANCE_KV.get(`name_${userId}`);
        const alreadyRegistered = getName != null;

        if (!args) {
            if (alreadyRegistered) {
                response = `📝 *Update your name:*\n\n\`/register [Your New Name] [Invite Code]\`\n\nExample:\n\`/register John Tan SP+U1234\``;                
            } else {
                response = `📝 *How to Register:*\n\n\`/register [Your Full Name] [Invite Code]\`\n\nExample:\n\`/register John Tan SP+U1234\`\n\nContact your leader to get the invite code.`;
            }
        } else {
            const parts = args.split(" ");
            if (parts.length < 2) {
                response = `📝 Please include your name AND invite code.\n\nExample:\n\`/register John Tan SP+U1234\``;
            } else {
                const code = parts[parts.length - 1];        // Last word = invite code
                const name = parts.slice(0, -1).join(" ");   // Everything else = name

                if (code === env.INVITE_CODE) {
                    // ✅ Save pending — don't save final data yet
                    await env.ATTENDANCE_KV.put(`reg_pending_${userId}`, JSON.stringify({
                        name,
                        alreadyRegistered,
                        telegramName,
                        username
                    }));


                    // enter group name
                    await sendKeyboard(
                        chatId,
                        `👥 *Almost done, ${name}!*\n\nPlease select your group:\n\n_If unsure, please check with your leader._`,
                        ministryGroupKeyboard(),
                        env.BOT_TOKEN
                    );
                    return;

                } else {
                    response = `❌ Wrong invite code.\n\nPlease check with your leader for the correct code.`;
                }
            }
        }
    }
 
    // ==========================================
    // STEP 1 — /start
    // ==========================================
    else if (text === "/start") {
        const name = await getName(userId, env);
        const role = await getRole(userId, env);
        const active = await isEventActive(env);

        // Not registered yet — show minimal welcome
        const registered = await env.ATTENDANCE_KV.get(`name_${userId}`);
        if (!registered && !isCreator) {
            response = `🙏 Welcome to *SP Navigators* Attendance Bot!\n\nThis bot is for SP Navigators members only.\n\nIf you have an invite code:\n\`/register [Your Name] [Invite Code]\`\n\nOtherwise contact your leader to get started.`;
            await sendMessage(chatId, response, env.BOT_TOKEN);
            return;
        }

        const event = await getEventFull(env);
        let msg = `🙏 Welcome *${name}* to SP Navigators!\n\n`;
 
        // Show event status
        const mode = await getEventMode(env);
        if (mode === "holiday") {
            msg += `🏖️ *No activity this week.*\n\nHoliday / VTP Break.\n\n`;
        } else if (mode === "standdown") {
            msg += `🙏 *CCA Stand down week!*\n\n📅 *${event}*\n\n`;
        } else if (!active) {
            msg += `❌ *Event is currently cancelled.*\n\nCheck with your leaders for updates.\n\n`;
        } else {
            msg += `📅 *${event}*\n\n`;
        }
 
        // Member commands (everyone)
        msg += `*Your Commands:*\n`;
        msg += `/rsvp — RSVP for the event\n`;
        msg += `/status — Check your RSVP\n`;
        msg += `/myid — Get your Telegram ID\n`;
        msg += `/register — Update your name\n`;
 
        // Leader commands
        if (role === "leader" || role === "admin") {
            msg += `\n🔐 *Leader Commands:*\n`;
            //msg += `/list — View attendance list\n`;
            msg += `/whatsapp — WhatsApp summary\n`;
            // msg += `/addmember — Add non-Telegram member\n`;
            // msg += `/removemember — Remove a member\n`;
        }
 
        // Admin commands
        if (role === "admin") {
            msg += `\n⚙️ *Admin Commands:*\n`;
            msg += `/members — View all registered members\n`;
            msg += `/setname — Set event name\n`;
            msg += `/setdate — Set event date\n`;
            msg += `/settime — Set event time\n`;
            msg += `/autodate — Reset to this Friday\n`;
            msg += `/activate — Activate event\n`;
            msg += `/cancel — Cancel the event\n`;
            msg += `/list — View attendance list\n`;
            msg += `/clear — Clear all RSVPs\n`;
            msg += `/normalweek — Set to Weekly Nav+U\n`;
            msg += `/standdown — Set to Prayer Walk\n`;
            msg += `/holiday — Set to School Holidays\n`;
        }
 
        // Login/logout based on role
        msg += role === "member"
            ? `\n/login — Login as leader or admin`
            : `\n/logout — End your session`;
 
        response = msg;
    }
 
    // ==========================================
    // STEP 3 — /login
    // ==========================================
    else if (text === "/login") {
        await sendKeyboard(
            chatId,
            `🔐 *Login Menu*\n\nSelect your role:`,
            loginKeyboard(),
            env.BOT_TOKEN
        );
        return;
    }
 
    // ==========================================
    // STEP 3 — /logout
    // ==========================================
    else if (text === "/logout") {
        const role = await getRole(userId, env);
        const name = await getName(userId, env);
        await env.ATTENDANCE_KV.delete(`role_${userId}`);
        response = `👋 *${name}*, logged out of *${role.toUpperCase()}* mode.\n\nYou are now back to member mode.`;
    }
 
    // ==========================================
    // STEP 5 — /rsvp
    // ==========================================
    else if (text === "/rsvp") {
        const active = await isEventActive(env);
        const name = await getName(userId, env);
        const event = await getEventFull(env);
 
        if (!active) {
            response = `❌ *Event has been cancelled.*\n\nPlease check with your leaders for updates.`;
        } else {
            await sendKeyboard(
                chatId,
                `📅 *${event}*\n\nAre you coming, *${name}*?`,
                rsvpKeyboard(),
                env.BOT_TOKEN
            );
            return;
        }
    }
 
    // ==========================================
    // STEP 9 — /status
    // ==========================================
    else if (text === "/status") {
        const name = await getName(userId, env);
        const event = await getEventFull(env);
        const active = await isEventActive(env);
        const status = await env.ATTENDANCE_KV.get(`rsvp_${userId}`);
 
        if (!active) {
            response = `❌ *Event has been cancelled.*`;
        } else if (status === "coming") {
            response = `✅ *${name}*, you are *COMING* to:\n📅 ${event}`;
        } else if (status === "notcoming") {
            response = `❌ *${name}*, you are *NOT COMING* to:\n📅 ${event}`;
        } else {
            response = `❓ *${name}*, you haven't RSVP'd yet.\n\nUse /rsvp to respond.`;
        }
    }
 
    // ==========================================
    // STEP 9 — /myid
    // ==========================================
    else if (text === "/myid") {
        response = `🪪 *Your Telegram ID:*\n\`${userId}\`\n\nShare this with your leader if they need to identify you.`;
    }
 
    // ==========================================
    // STEP 6 — /list (Leaders only)
    // ==========================================
    else if (text === "/list") {
        const leader = await isLeader(userId, env);
        if (!leader) {
            response = `❌ This command is for leaders only.\n\nUse /login to login as a leader.`;
        } else {
            const event = await getEventFull(env);
            const active = await isEventActive(env);
            const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
            const coming = [], notcoming = [];
 
            for (const key of list.keys) {
                const status = await env.ATTENDANCE_KV.get(key.name);
                const memberId = key.name.replace("rsvp_", "");
                const memberName = await getName(memberId, env);
                // Show ID for Telegram users, not for non-telegram members
                const isNonTele = memberId.startsWith("nontelegram:");
                const label = isNonTele ? memberName : `${memberName} (${memberId})`;
                if (status === "coming") coming.push(label);
                else if (status === "notcoming") notcoming.push(label);
            }
 
            const activeTag = active ? "" : " *(cancelled)*";
            response = `📋 *${event}*${activeTag}\n\n`;
            response += `✅ *Coming (${coming.length}):*\n`;
            response += coming.map(n => `• ${n}`).join("\n") || "• None";
            response += `\n\n❌ *Not Coming (${notcoming.length}):*\n`;
            response += notcoming.map(n => `• ${n}`).join("\n") || "• None";
        }
    }
 
    // ==========================================
    // STEP 6 — /whatsapp (Leaders only)
    // ==========================================
    else if (text === "/whatsapp") {
        const leader = await isLeader(userId, env);
        if (!leader) {
            response = `❌ This command is for leaders only.\n\nUse /login to login as a leader.`;
        } else {
            const name = await getEventName(env);
            const date = await getEventDate(env);
            const time = await getEventTime(env);
            const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
            const coming = [], notcoming = [];
 
            for (const key of list.keys) {
                const status = await env.ATTENDANCE_KV.get(key.name);
                const memberId = key.name.replace("rsvp_", "");
                const memberName = await getName(memberId, env);
                if (status === "coming") coming.push(memberName);
                else if (status === "notcoming") notcoming.push(memberName);
            }
 
            let msg = `*《SP NAVIGATORS ATTENDANCE》*\n\n`;
            msg += `📅 *${name}*\n`;
            msg += `🗓 ${date}  🕐 ${time}\n\n`;
            msg += `✅ *COMING (${coming.length})*\n`;
            coming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
            if (coming.length === 0) msg += `None\n`;
            msg += `\n❌ *NOT COMING (${notcoming.length})*\n`;
            notcoming.forEach((n, i) => msg += `${i + 1}. ${n}\n`);
            if (notcoming.length === 0) msg += `None\n`;
            response = msg;
        }
    }
 
    // ==========================================
    // STEP 8 — /addmember (Leaders only)
    // ==========================================
    // else if (text.startsWith("/addmember")) {
    //     const leader = await isLeader(userId, env);
    //     if (!leader) {
    //         response = `❌ Leaders only.`;
    //     } else {
    //         const name = text.substring(11).trim();
    //         if (!name) {
    //             response = `Usage: \`/addmember James Wong\``;
    //         } else {
    //             const key = `nontelegram:${name}`;
    //             await env.ATTENDANCE_KV.put(`name_${key}`, name);
    //             response = `✅ Added *${name}* as a non-Telegram member!`;
    //         }
    //     }
    // }
 
    // ==========================================
    // STEP 8 — /removemember (Leaders only)
    // ==========================================
    // else if (text.startsWith("/removemember")) {
    //     const leader = await isLeader(userId, env);
    //     if (!leader) {
    //         response = `❌ Leaders only.`;
    //     } else {
    //         const name = text.substring(14).trim();
    //         if (!name) {
    //             response = `Usage: \`/removemember James Wong\``;
    //         } else {
    //             const key = `nontelegram:${name}`;
    //             const exists = await env.ATTENDANCE_KV.get(`name_${key}`);
    //             if (!exists) {
    //                 response = `❌ *"${name}"* not found.\n\nMake sure the name matches exactly.`;
    //             } else {
    //                 await env.ATTENDANCE_KV.delete(`name_${key}`);
    //                 await env.ATTENDANCE_KV.delete(`rsvp_${key}`);
    //                 response = `✅ Removed *${name}* from the member list.`;
    //             }
    //         }
    //     }
    // }
 
    // ==========================================
    // STEP 7 — /setname (Admin only)
    // ==========================================
    else if (text.startsWith("/setname")) {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            const val = text.substring(9).trim();
            if (!val) {
                response = `Usage: \`/setname Weekly Nav+U\``;
            } else {
                await env.ATTENDANCE_KV.put("event_name", val);
                const full = await getEventFull(env);
                response = `✅ Event name updated!\n\n📅 *${full}*`;
            }
        }
    }
 
    // ==========================================
    // STEP 7 — /setdate (Admin only)
    // ==========================================
    else if (text.startsWith("/setdate")) {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            const val = text.substring(9).trim();
            if (!val) {
                response = `Usage: \`/setdate 5 September 2026 (Fri)\``;
            } else {
                await env.ATTENDANCE_KV.put("event_date", val);
                const full = await getEventFull(env);
                response = `✅ Event date updated!\n\n📅 *${full}*`;
            }
        }
    }
 
    // ==========================================
    // STEP 7 — /settime (Admin only)
    // ==========================================
    else if (text.startsWith("/settime")) {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            const val = text.substring(9).trim();
            if (!val) {
                response = `Usage: \`/settime 5:30pm\``;
            } else {
                await env.ATTENDANCE_KV.put("event_time", val);
                const full = await getEventFull(env);
                response = `✅ Event time updated!\n\n📅 *${full}*`;
            }
        }
    }
 
    // ==========================================
    // STEP 7 — /autodate (Admin only)
    // ==========================================
    else if (text === "/autodate") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.delete("event_date");
            const full = await getEventFull(env);
            response = `✅ Date reset to auto!\n\n📅 *${full}*`;
        }
    }
 
    // ==========================================
    // STEP 7 — /cancel (Admin only)
    // ==========================================
    else if (text === "/cancel") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.put("event_active", "false");
            const full = await getEventFull(env);
            response = `❌ *Event has been cancelled.*\n\n📅 ${full}\n\nMembers will see a cancellation notice when they try to RSVP.`;
        }
    }
 
    // ==========================================
    // STEP 7 — /activate (Admin only)
    // ==========================================
    else if (text === "/activate") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.put("event_active", "true");
            const full = await getEventFull(env);
            response = `✅ *Event is now active!*\n\n📅 *${full}*\n\nMembers can now RSVP.`;
        }
    }

    // /standdown — switch to Prayer Walk mode
    else if (text === "/standdown") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.put("event_mode", "standdown");
            await env.ATTENDANCE_KV.put("event_name", "Prayer Walk");
            const full = await getEventFull(env);
            response = `🙏 *CCA Stand down mode activated!*\n\nEvent changed to Prayer Walk.\n\n📅 *${full}*\n\nMembers will see Prayer Walk when they RSVP.`;
        }
    }

    // /holiday — no activity this week
    else if (text === "/holiday") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.put("event_mode", "holiday");
            await env.ATTENDANCE_KV.put("event_active", "false");
            response = `🏖️ *Holiday / VTP Break mode activated!*\n\nNo Friday activity.\n\nMembers will see a notice when they check /start or /rsvp.`;
        }
    }
 
    // /normalweek — back to normal Nav+U
    else if (text === "/normalweek") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            await env.ATTENDANCE_KV.put("event_mode", "normal");
            await env.ATTENDANCE_KV.put("event_name", "Weekly Nav+U");
            await env.ATTENDANCE_KV.put("event_active", "true");
            const full = await getEventFull(env);
            response = `✅ *Back to normal week!*\n\nEvent reset to Weekly Nav+U.\n\n📅 *${full}*`;
        }
    }

    // ==========================================
    // STEP 7 — /clear (Admin only)
    // ==========================================
    else if (text === "/clear") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            const list = await env.ATTENDANCE_KV.list({ prefix: "rsvp_" });
            for (const key of list.keys) {
                await env.ATTENDANCE_KV.delete(key.name);
            }
            const full = await getEventFull(env);
            response = `🗑️ *All RSVPs cleared!*\n\nReady for a new week.\n📅 ${full}`;
        }
    }

    // /members — view all registered members (admin only)
    else if (text === "/members") {
        const admin = await isAdmin(userId, env);
        if (!admin) {
            response = `❌ Admin only.`;
        } else {
            const list = await env.ATTENDANCE_KV.list({ prefix: "name_" });
            const telegramMembers = [];
            const nonTeleMembers = [];

            for (const key of list.keys) {
                const memberName = await env.ATTENDANCE_KV.get(key.name);
                const memberId = key.name.replace("name_", "");
                if (memberId.startsWith("nontelegram:")) {
                    nonTeleMembers.push(memberName);
                } else {
                    telegramMembers.push(`${memberName} (${memberId})`);
                }
            }

            const total = telegramMembers.length; //+ nonTeleMembers.length;
            response = `👥 *All Registered Members*\n\n`;
            response += `📱 *Telegram (${telegramMembers.length}):*\n`;
            response += telegramMembers.map(m => `• ${m}`).join("\n") || `• None`;
            //response += `\n\n📝 *Non-Telegram (${nonTeleMembers.length}):*\n`;
            //response += nonTeleMembers.map(m => `• ${m}`).join("\n") || `• None`;
            //response += `\n\n📊 *Total: ${total}*`;
        }
    }
 
    // ==========================================
    // STEP 10 — Unknown command
    // ==========================================
    else if (text.startsWith("/")) {
        response = `❓ Unknown command.\n\nType /start to see all available commands.`;
    }
 
    if (response) {
        await sendMessage(chatId, response, env.BOT_TOKEN);
    }
}
 
// ============================================
// WORKER ENTRY POINT
// ============================================
export default {
    async fetch(request, env) {
        return await handleRequest(request, env);
    }
};