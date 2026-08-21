var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
function getCurrentWeekFriday() {
  const today = /* @__PURE__ */ new Date();
  const dayOfWeek = today.getDay();
  let targetFriday = new Date(today);
  if (dayOfWeek === 6) {
    targetFriday.setDate(today.getDate() + 6);
  } else if (dayOfWeek === 0) {
    targetFriday.setDate(today.getDate() + 5);
  } else {
    targetFriday.setDate(today.getDate() + (5 - dayOfWeek));
  }
  const day = targetFriday.getDate();
  const month = targetFriday.toLocaleString("en-US", { month: "long" });
  const year = targetFriday.getFullYear();
  const weekday = targetFriday.toLocaleString("en-US", { weekday: "short" });
  return `${day} ${month} ${year} (${weekday})`;
}
__name(getCurrentWeekFriday, "getCurrentWeekFriday");
function getDateKey() {
  const today = /* @__PURE__ */ new Date();
  return today.toISOString().slice(0, 10).replace(/-/g, "");
}
__name(getDateKey, "getDateKey");
async function getUserDisplayName(userId, env, telegramName) {
  const registeredName = await env.ATTENDANCE_KV.get(`registered_name_${userId}`);
  return registeredName || telegramName || "Member";
}
__name(getUserDisplayName, "getUserDisplayName");
async function isApprovedUser(userId, env) {
  const approved = await env.ATTENDANCE_KV.get(`approved_user_${userId}`);
  return approved === "true";
}
__name(isApprovedUser, "isApprovedUser");
async function approveUser(userId, env) {
  await env.ATTENDANCE_KV.put(`approved_user_${userId}`, "true");
}
__name(approveUser, "approveUser");
async function removeApprovedUser(userId, env) {
  await env.ATTENDANCE_KV.delete(`approved_user_${userId}`);
}
__name(removeApprovedUser, "removeApprovedUser");
async function isAdmin(userId, env) {
  const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
  return role === "admin";
}
__name(isAdmin, "isAdmin");
async function isLeader(userId, env) {
  const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
  return role === "admin" || role === "leader";
}
__name(isLeader, "isLeader");
async function getUserRole(userId, env) {
  const role = await env.ATTENDANCE_KV.get(`role_${userId}`);
  return role || "member";
}
__name(getUserRole, "getUserRole");
async function getUserGroup(memberId, env) {
  return await env.ATTENDANCE_KV.get(`group_${memberId}`) || "Unassigned";
}
__name(getUserGroup, "getUserGroup");
async function setUserGroup(memberId, groupName, env) {
  await env.ATTENDANCE_KV.put(`group_${memberId}`, groupName);
}
__name(setUserGroup, "setUserGroup");
async function getEvent(eventId, env) {
  const raw = await env.ATTENDANCE_KV.get(`event_${eventId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}
__name(getEvent, "getEvent");
async function saveEvent(event, env) {
  await env.ATTENDANCE_KV.put(`event_${event.id}`, JSON.stringify(event));
}
__name(saveEvent, "saveEvent");
async function getAllEvents(env) {
  const list = await env.ATTENDANCE_KV.list({ prefix: "event_" });
  const events = [];
  for (const key of list.keys) {
    const raw = await env.ATTENDANCE_KV.get(key.name);
    if (raw) events.push(JSON.parse(raw));
  }
  events.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  return events;
}
__name(getAllEvents, "getAllEvents");
async function getActiveEvents(env) {
  const all = await getAllEvents(env);
  return all.filter((e) => e.active !== false);
}
__name(getActiveEvents, "getActiveEvents");
async function ensureDefaultEvent(env) {
  const all = await getAllEvents(env);
  if (all.length === 0) {
    const defaultEvent = {
      id: "default",
      name: "Weekly Nav+U",
      date: getCurrentWeekFriday(),
      time: "5:30pm",
      active: true,
      created: getDateKey()
    };
    await saveEvent(defaultEvent, env);
    return defaultEvent;
  }
  return null;
}
__name(ensureDefaultEvent, "ensureDefaultEvent");
function formatEvent(event) {
  return `${event.name} on ${event.date} at ${event.time}`;
}
__name(formatEvent, "formatEvent");
async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
}
__name(sendMessage, "sendMessage");
async function sendMessageWithKeyboard(chatId, text, keyboard, token) {
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
__name(sendMessageWithKeyboard, "sendMessageWithKeyboard");
function getLoginKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "\u{1F510} Login as Leader", callback_data: "login_leader" }],
      [{ text: "\u{1F510} Login as Admin", callback_data: "login_admin" }],
      [{ text: "\u274C Logout", callback_data: "logout" }]
    ]
  };
}
__name(getLoginKeyboard, "getLoginKeyboard");
async function sendAdminNotification(name, userName, userId, env) {
  if (!env.ADMIN_USER_ID) return;
  const keyboard = {
    inline_keyboard: [[
      { text: "\u2705 Keep Approved", callback_data: `keep_${userId}` },
      { text: "\u274C Unapprove", callback_data: `unapprove_${userId}` }
    ]]
  };
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: parseInt(env.ADMIN_USER_ID),
      text: `\u{1F514} *New Registration!*

Name: *${name}*
Telegram: ${userName}
User ID: \`${userId}\`

Auto-approved. Tap below if you don't recognise them.`,
      parse_mode: "Markdown",
      reply_markup: keyboard
    })
  });
}
__name(sendAdminNotification, "sendAdminNotification");
async function sendRsvpEventPicker(chatId, events, env) {
  const buttons = events.map((e) => [{
    text: `\u{1F4C5} ${e.name} \u2014 ${e.date}`,
    callback_data: `rsvp_pick_${e.id}`
  }]);
  const keyboard = { inline_keyboard: buttons };
  await sendMessageWithKeyboard(
    chatId,
    `\u{1F4CB} *Select an event to RSVP for:*`,
    keyboard,
    env.BOT_TOKEN
  );
}
__name(sendRsvpEventPicker, "sendRsvpEventPicker");
async function sendYesNoKeyboard(chatId, eventId, event, displayName, env) {
  const keyboard = {
    inline_keyboard: [[
      { text: "\u2705 Coming", callback_data: `yes_${eventId}` },
      { text: "\u274C Not Coming", callback_data: `no_${eventId}` }
    ]]
  };
  await sendMessageWithKeyboard(
    chatId,
    `\u{1F4C5} *${formatEvent(event)}*

Are you coming, ${displayName}?`,
    keyboard,
    env.BOT_TOKEN
  );
}
__name(sendYesNoKeyboard, "sendYesNoKeyboard");
async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === `/webhook/${env.BOT_TOKEN}`) {
    if (request.method === "POST") {
      const update = await request.json();
      await handleUpdate(update, env);
      return new Response("OK");
    }
  }
  if (url.pathname === "/setup") {
    return new Response(`Setup webhook:
https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${url.origin}/webhook/${env.BOT_TOKEN}`);
  }
  return new Response("SP Navigators Attendance Bot is running!", { status: 200 });
}
__name(handleRequest, "handleRequest");
async function handleUpdate(update, env) {
  if (update.callback_query) {
    const query = update.callback_query;
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: query.id })
    });
    const userId2 = query.from.id;
    const userName2 = query.from.first_name;
    const data = query.data;
    const chatId2 = query.message.chat.id;
    const displayName = await getUserDisplayName(userId2, env, userName2);
    let response2 = "";
    if (data.startsWith("keep_")) {
      const targetId = data.replace("keep_", "");
      const name = await env.ATTENDANCE_KV.get(`registered_name_${targetId}`);
      response2 = `\u2705 ${name || targetId} remains approved.`;
    } else if (data.startsWith("unapprove_")) {
      const targetId = data.replace("unapprove_", "");
      const name = await env.ATTENDANCE_KV.get(`registered_name_${targetId}`);
      await removeApprovedUser(parseInt(targetId), env);
      response2 = `\u274C ${name || targetId} has been unapproved.`;
    } else if (data === "login_admin") {
      await env.ATTENDANCE_KV.put(`login_temp_${userId2}`, "admin");
      response2 = `\u{1F510} Please type the admin password:`;
    } else if (data === "login_leader") {
      await env.ATTENDANCE_KV.put(`login_temp_${userId2}`, "leader");
      response2 = `\u{1F510} Please type the leader password:`;
    } else if (data === "logout") {
      await env.ATTENDANCE_KV.delete(`role_${userId2}`);
      response2 = `\u{1F44B} ${displayName}, you have been logged out.`;
    } else if (data.startsWith("rsvp_pick_")) {
      const eventId = data.replace("rsvp_pick_", "");
      const event = await getEvent(eventId, env);
      if (!event) {
        response2 = `\u274C Event not found.`;
      } else if (!event.active) {
        response2 = `\u274C *${event.name}* has been cancelled.`;
      } else {
        await env.ATTENDANCE_KV.put(`temp_event_${userId2}`, eventId);
        await sendYesNoKeyboard(chatId2, eventId, event, displayName, env);
        return;
      }
    } else if (data.startsWith("yes_")) {
      const eventId = data.replace("yes_", "");
      const event = await getEvent(eventId, env);
      if (!event) {
        response2 = `\u274C Event not found.`;
      } else if (!event.active) {
        response2 = `\u274C Sorry, *${event.name}* has been cancelled. You cannot RSVP.`;
      } else {
        await env.ATTENDANCE_KV.put(`attendance_${eventId}_${userId2}`, "coming");
        await saveAttendanceHistory(userId2, eventId, "coming", env);
        response2 = `\u2705 Great, ${displayName}! You are marked as *COMING* to ${formatEvent(event)} \u{1F64F}`;
      }
    } else if (data.startsWith("no_")) {
      const eventId = data.replace("no_", "");
      const event = await getEvent(eventId, env);
      if (!event) {
        response2 = `\u274C Event not found.`;
      } else if (!event.active) {
        response2 = `\u274C Sorry, *${event.name}* has been cancelled.`;
      } else {
        await env.ATTENDANCE_KV.put(`attendance_${eventId}_${userId2}`, "notcoming");
        await saveAttendanceHistory(userId2, eventId, "notcoming", env);
        response2 = `\u274C Noted, ${displayName}! Marked as *NOT COMING* to ${formatEvent(event)}

We'll miss you! \u{1F64F}`;
      }
    }
    if (response2) await sendMessage(chatId2, response2, env.BOT_TOKEN);
    return;
  }
  if (!update.message) return;
  const chatId = update.message.chat.id;
  const text = update.message.text;
  const userId = update.message.from.id;
  const userName = update.message.from.first_name;
  if (!text) return;
  await env.ATTENDANCE_KV.put(`name_${userId}`, userName);
  await ensureDefaultEvent(env);
  const isCreator = userId === parseInt(env.ADMIN_USER_ID);
  if (isCreator) await approveUser(userId, env);
  const isApproved = await isApprovedUser(userId, env);
  const publicCommands = ["/start", "/register"];
  const isPublicCommand = publicCommands.some((cmd) => text === cmd || text.startsWith(cmd + " "));
  if (!isApproved && !isCreator && !isPublicCommand) {
    if (text === "/start") {
      await sendMessage(
        chatId,
        `\u{1F64F} Welcome to SP Navigators Attendance Bot!

This bot is for SP Navigators members only.

If you have an invite code from your leader:
\`/register [Your Name] [Invite Code]\`

Otherwise, contact your personal leader to get started.`,
        env.BOT_TOKEN
      );
    }
    return;
  }
  if (!text.startsWith("/")) {
    const loginType = await env.ATTENDANCE_KV.get(`login_temp_${userId}`);
    const displayName = await getUserDisplayName(userId, env, userName);
    if (loginType) {
      await env.ATTENDANCE_KV.delete(`login_temp_${userId}`);
      let response2 = "";
      if (loginType === "admin") {
        if (text === env.ADMIN_PASSWORD) {
          await env.ATTENDANCE_KV.put(`role_${userId}`, "admin");
          response2 = `\u2705 ${displayName}, you are now *ADMIN*!

Type /start to see the admin menu.`;
        } else {
          response2 = `\u274C Incorrect admin password. Try again with /login`;
        }
      } else if (loginType === "leader") {
        if (text === env.LEADER_PASSWORD) {
          await env.ATTENDANCE_KV.put(`role_${userId}`, "leader");
          response2 = `\u2705 ${displayName}, you are now *LEADER*!

Type /start to see the leader menu.`;
        } else {
          response2 = `\u274C Incorrect leader password. Try again with /login`;
        }
      }
      await sendMessage(chatId, response2, env.BOT_TOKEN);
      return;
    }
    return;
  }
  const isRegistered = await env.ATTENDANCE_KV.get(`registered_name_${userId}`);
  const regAllowed = ["/start", "/register", "/login"];
  const isRegAllowed = regAllowed.some((cmd) => text === cmd || text.startsWith(cmd + " "));
  if (isApproved && !isRegistered && !isRegAllowed) {
    await sendMessage(
      chatId,
      `\u{1F44B} Please register your name first.

Use:
\`/register [Your Name] [Invite Code]\``,
      env.BOT_TOKEN
    );
    return;
  }
  const today = /* @__PURE__ */ new Date();
  const dayOfWeek = today.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    const weekendAllowed = ["/start", "/login", "/logout", "/myevents", "/register", "/status", "/help"];
    const isWeekendAllowed = weekendAllowed.some((cmd) => text === cmd || text.startsWith(cmd + " "));
    if (!isWeekendAllowed) {
      await sendMessage(
        chatId,
        `\u274C RSVP is closed this weekend.

\u{1F4C5} Come back Monday to RSVP for next week's Nav+U.

\u{1F64F} Have a blessed weekend!`,
        env.BOT_TOKEN
      );
      return;
    }
  }
  let response = "";
  if (text.startsWith("/register")) {
    const args = text.substring(9).trim();
    if (!args) {
      response = `\u{1F4DD} To register:
\`/register [Your Full Name] [Invite Code]\`

Contact your leader for the invite code.`;
    } else {
      const parts = args.split(" ");
      if (parts.length < 2) {
        response = `Usage: \`/register [Your Name] [Invite Code]\``;
      } else {
        const name = parts.slice(0, -1).join(" ");
        const code = parts[parts.length - 1];
        if (code === env.INVITE_CODE) {
          await env.ATTENDANCE_KV.put(`registered_name_${userId}`, name);
          await env.ATTENDANCE_KV.put(`approved_user_${userId}`, "true");
          response = `\u2705 Welcome, *${name}*! You are now registered.

Use /rsvp to RSVP for the next event.`;
          await sendAdminNotification(name, userName, userId, env);
        } else {
          response = `\u274C Invalid invite code. Check with your leader.`;
        }
      }
    }
  } else if (text === "/start" || text === "/help") {
    const role = await getUserRole(userId, env);
    const displayName = await getUserDisplayName(userId, env, userName);
    if (!isRegistered) {
      response = `\u{1F64F} Welcome ${userName}!

Please register to get started:
\`/register [Your Name] [Invite Code]\`

Contact your leader if you need the invite code.`;
    } else {
      const activeEvents = await getActiveEvents(env);
      let welcome = `\u{1F64F} Welcome *${displayName}* to SP Navigators!

`;
      if (activeEvents.length === 0) {
        welcome += `\u274C *No active events right now.*

`;
      } else if (activeEvents.length === 1) {
        welcome += `\u{1F4C5} *Current Event:* ${formatEvent(activeEvents[0])}

`;
      } else {
        welcome += `\u{1F4C5} *Active Events (${activeEvents.length}):*
`;
        activeEvents.forEach((e, i) => {
          welcome += `${i + 1}. ${e.name} \u2014 ${e.date}
`;
        });
        welcome += `
`;
      }
      welcome += `*Member Commands:*
`;
      welcome += `/rsvp \u2014 RSVP for an event
`;
      welcome += `/myevents \u2014 Your RSVP history
`;
      welcome += `/status \u2014 Check current RSVP status
`;
      welcome += `/mygroup \u2014 See your group
`;
      welcome += `/register \u2014 Update your name
`;
      if (role === "leader" || role === "admin") {
        welcome += `
\u{1F510} *Leader Commands:*
`;
        welcome += `/list \u2014 View attendance (all events)
`;
        welcome += `/list [eventId] \u2014 View specific event
`;
        welcome += `/addmember [name] \u2014 Add non-Telegram member
`;
        welcome += `/removemember [name] \u2014 Remove member
`;
        welcome += `/allmembers \u2014 List all members
`;
        welcome += `/assigngroup [memberId or name] [group] \u2014 Assign group
`;
        welcome += `/listgroups \u2014 View all groups
`;
        welcome += `/whatsapp \u2014 WhatsApp summary (by group)
`;
        welcome += `/whatsapp [eventId] \u2014 Specific event
`;
        welcome += `/export \u2014 Export CSV
`;
      }
      if (role === "admin") {
        welcome += `
\u2699\uFE0F *Admin Only:*
`;
        welcome += `/newevent [id] [name] | [date] | [time] \u2014 Create event
`;
        welcome += `/events \u2014 List all events
`;
        welcome += `/cancelevent [id] \u2014 Cancel an event
`;
        welcome += `/activateevent [id] \u2014 Reactivate event
`;
        welcome += `/clearevent [id] \u2014 Clear attendance for event
`;
        welcome += `/deleteevent [id] \u2014 Delete event entirely
`;
        welcome += `/approve [userId] \u2014 Approve a user
`;
        welcome += `/unapprove [userId] \u2014 Remove approval
`;
        welcome += `/setinvite [code] \u2014 Change invite code
`;
      }
      welcome += role === "member" ? `
/login \u2014 Login as leader or admin` : `
/logout \u2014 End session`;
      welcome += `

\u{1F512} Your data is stored securely and only shared with leaders.`;
      response = welcome;
    }
  } else if (text === "/login") {
    await sendMessageWithKeyboard(chatId, `\u{1F510} *Login Menu*

Select an option:`, getLoginKeyboard(), env.BOT_TOKEN);
    return;
  } else if (text === "/logout") {
    const role = await getUserRole(userId, env);
    const displayName = await getUserDisplayName(userId, env, userName);
    await env.ATTENDANCE_KV.delete(`role_${userId}`);
    response = `\u{1F44B} ${displayName}, logged out of ${role.toUpperCase()} mode.`;
  } else if (text === "/rsvp") {
    const activeEvents = await getActiveEvents(env);
    const displayName = await getUserDisplayName(userId, env, userName);
    if (activeEvents.length === 0) {
      response = `\u274C There are no active events to RSVP for right now.

Check with your leaders for updates.`;
    } else if (activeEvents.length === 1) {
      const event = activeEvents[0];
      await env.ATTENDANCE_KV.put(`temp_event_${userId}`, event.id);
      await sendYesNoKeyboard(chatId, event.id, event, displayName, env);
      return;
    } else {
      await sendRsvpEventPicker(chatId, activeEvents, env);
      return;
    }
  } else if (text === "/yes") {
    const eventId = await env.ATTENDANCE_KV.get(`temp_event_${userId}`);
    if (!eventId) {
      response = `\u274C Please use /rsvp first to select an event.`;
    } else {
      const event = await getEvent(eventId, env);
      if (!event) {
        response = `\u274C Event not found. Use /rsvp to select again.`;
      } else if (!event.active) {
        response = `\u274C *${event.name}* has been cancelled. You cannot RSVP.`;
      } else {
        const displayName = await getUserDisplayName(userId, env, userName);
        await env.ATTENDANCE_KV.put(`attendance_${eventId}_${userId}`, "coming");
        await saveAttendanceHistory(userId, eventId, "coming", env);
        response = `\u2705 Great, ${displayName}! You are *COMING* to ${formatEvent(event)} \u{1F64F}`;
      }
    }
  } else if (text === "/no") {
    const eventId = await env.ATTENDANCE_KV.get(`temp_event_${userId}`);
    if (!eventId) {
      response = `\u274C Please use /rsvp first to select an event.`;
    } else {
      const event = await getEvent(eventId, env);
      if (!event) {
        response = `\u274C Event not found. Use /rsvp to select again.`;
      } else if (!event.active) {
        response = `\u274C *${event.name}* has been cancelled.`;
      } else {
        const displayName = await getUserDisplayName(userId, env, userName);
        await env.ATTENDANCE_KV.put(`attendance_${eventId}_${userId}`, "notcoming");
        await saveAttendanceHistory(userId, eventId, "notcoming", env);
        response = `\u274C Noted, ${displayName}! *NOT COMING* to ${formatEvent(event)}

We'll miss you! \u{1F64F}`;
      }
    }
  } else if (text === "/status") {
    const eventId = await env.ATTENDANCE_KV.get(`temp_event_${userId}`);
    const displayName = await getUserDisplayName(userId, env, userName);
    if (!eventId) {
      response = `\u274C Use /rsvp first to select an event.`;
    } else {
      const event = await getEvent(eventId, env);
      const status = await env.ATTENDANCE_KV.get(`attendance_${eventId}_${userId}`);
      const eventLabel = event ? formatEvent(event) : eventId;
      if (!event) {
        response = `\u274C Event not found.`;
      } else if (!event.active) {
        response = `\u274C *${event.name}* has been cancelled.`;
      } else if (status === "coming") {
        response = `\u2705 ${displayName}, you are *COMING* to ${eventLabel}`;
      } else if (status === "notcoming") {
        response = `\u274C ${displayName}, you are *NOT COMING* to ${eventLabel}`;
      } else {
        response = `\u2753 ${displayName}, you haven't responded yet for ${eventLabel}.

Use /rsvp to respond.`;
      }
    }
  } else if (text === "/myevents") {
    const displayName = await getUserDisplayName(userId, env, userName);
    const allEvents = await getAllEvents(env);
    if (allEvents.length === 0) {
      response = `\u2753 No events found.`;
    } else {
      response = `\u{1F4CB} *${displayName}'s RSVP History*

`;
      let hasAny = false;
      for (const event of allEvents) {
        const status = await env.ATTENDANCE_KV.get(`attendance_${event.id}_${userId}`);
        const statusIcon = status === "coming" ? "\u2705" : status === "notcoming" ? "\u274C" : "\u2753";
        const statusText = status === "coming" ? "Coming" : status === "notcoming" ? "Not Coming" : "No response";
        const activeTag = event.active ? "" : " *(cancelled)*";
        response += `${statusIcon} *${event.name}*${activeTag}
`;
        response += `   \u{1F4C5} ${event.date} at ${event.time}
`;
        response += `   Status: ${statusText}

`;
        hasAny = true;
      }
      if (!hasAny) response += `No events yet.`;
    }
  } else if (text === "/mygroup") {
    const displayName = await getUserDisplayName(userId, env, userName);
    const group = await getUserGroup(userId, env);
    response = `\u{1F465} ${displayName}, you are in: *${group}*`;
  } else if (text === "/events") {
    const isAdminUser = await isAdmin(userId, env);
    const events = isAdminUser ? await getAllEvents(env) : await getActiveEvents(env);
    if (events.length === 0) {
      response = `\u274C No events found.`;
    } else {
      response = `\u{1F4C5} *Events:*

`;
      for (const e of events) {
        const statusTag = e.active ? "\u{1F7E2} Active" : "\u{1F534} Cancelled";
        response += `*${e.name}*
`;
        response += `   ID: \`${e.id}\`
`;
        response += `   \u{1F4C5} ${e.date} at ${e.time}
`;
        response += `   ${statusTag}

`;
      }
    }
  } else if (text.startsWith("/list")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only. Use /login first.`;
    } else {
      const args = text.substring(5).trim();
      let eventsToList = [];
      if (args) {
        const event = await getEvent(args, env);
        if (!event) {
          response = `\u274C Event "${args}" not found. Use /events to see event IDs.`;
        } else {
          eventsToList = [event];
        }
      } else {
        eventsToList = await getActiveEvents(env);
        if (eventsToList.length === 0) eventsToList = await getAllEvents(env);
      }
      if (eventsToList.length > 0 && !response) {
        response = "";
        for (const event of eventsToList) {
          const prefix = `attendance_${event.id}_`;
          const list = await env.ATTENDANCE_KV.list({ prefix });
          const coming = [], notcoming = [];
          for (const key of list.keys) {
            const status = await env.ATTENDANCE_KV.get(key.name);
            const memberId = key.name.replace(prefix, "");
            let memberName = await env.ATTENDANCE_KV.get(`registered_name_${memberId}`);
            if (!memberName) memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
            if (!memberName) memberName = memberId;
            if (status === "coming") coming.push(memberName);
            else if (status === "notcoming") notcoming.push(memberName);
          }
          const activeTag = event.active ? "" : " *(cancelled)*";
          response += `\u{1F4CB} *${event.name}*${activeTag}
`;
          response += `\u{1F4C5} ${event.date} at ${event.time}

`;
          response += `\u2705 Coming (${coming.length}):
${coming.map((n) => `\u2022 ${n}`).join("\n") || "\u2022 None"}

`;
          response += `\u274C Not coming (${notcoming.length}):
${notcoming.map((n) => `\u2022 ${n}`).join("\n") || "\u2022 None"}

`;
          response += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
        }
      }
    }
  } else if (text.startsWith("/whatsapp")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only. Use /login first.`;
    } else {
      const args = text.substring(9).trim();
      let eventsToShow = [];
      if (args) {
        const event = await getEvent(args, env);
        if (!event) {
          response = `\u274C Event "${args}" not found.`;
        } else {
          eventsToShow = [event];
        }
      } else {
        eventsToShow = await getActiveEvents(env);
        if (eventsToShow.length === 0) eventsToShow = await getAllEvents(env);
      }
      if (eventsToShow.length > 0 && !response) {
        let msg = `\u300ASP NAVIGATORS ATTENDANCE\u300B

`;
        for (const event of eventsToShow) {
          msg += `\u{1F4C5} *${event.name}*
`;
          msg += `\u{1F5D3} ${event.date}  \u{1F550} ${event.time}

`;
          const prefix = `attendance_${event.id}_`;
          const list = await env.ATTENDANCE_KV.list({ prefix });
          const groupMap = {};
          for (const key of list.keys) {
            const status = await env.ATTENDANCE_KV.get(key.name);
            const memberId = key.name.replace(prefix, "");
            let memberName = await env.ATTENDANCE_KV.get(`registered_name_${memberId}`);
            if (!memberName) memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
            if (!memberName) memberName = memberId;
            const group = await getUserGroup(memberId, env);
            if (!groupMap[group]) groupMap[group] = { coming: [], notcoming: [] };
            if (status === "coming") groupMap[group].coming.push(memberName);
            else if (status === "notcoming") groupMap[group].notcoming.push(memberName);
          }
          const groups = Object.keys(groupMap).sort();
          if (groups.length === 0) {
            msg += `_No responses yet._
`;
          } else {
            for (const group of groups) {
              msg += `\u{1F4CC} *${group.toUpperCase()}*
`;
              const { coming, notcoming } = groupMap[group];
              if (coming.length > 0) {
                msg += `\u2705 Coming (${coming.length}): ${coming.join(", ")}
`;
              }
              if (notcoming.length > 0) {
                msg += `\u274C Not Coming (${notcoming.length}): ${notcoming.join(", ")}
`;
              }
              msg += `
`;
            }
          }
          msg += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
        }
        response = msg;
      }
    }
  } else if (text.startsWith("/assigngroup")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const args = text.substring(13).trim();
      const parts = args.split(" ");
      if (parts.length < 2) {
        response = `Usage: \`/assigngroup [userId or name] [Group Name]\`

Examples:
\`/assigngroup 123456789 Group 1\`
\`/assigngroup James Wong Refresher\``;
      } else {
        const firstPart = parts[0];
        const isNumeric = /^\d+$/.test(firstPart);
        let memberId, groupName;
        if (isNumeric) {
          memberId = firstPart;
          groupName = parts.slice(1).join(" ");
        } else {
          groupName = parts[parts.length - 1];
          const memberName = parts.slice(0, -1).join(" ");
          memberId = `nontelegram:${memberName}`;
          const exists = await env.ATTENDANCE_KV.get(`registered_name_${memberId}`);
          if (!exists) {
            response = `\u274C Member "${memberName}" not found. For Telegram users, use their user ID instead.`;
          }
        }
        if (!response) {
          await setUserGroup(memberId, groupName, env);
          let memberName = await env.ATTENDANCE_KV.get(`registered_name_${memberId}`);
          if (!memberName) memberName = memberId;
          response = `\u2705 *${memberName}* assigned to group: *${groupName}*`;
        }
      }
    }
  } else if (text === "/listgroups") {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const registeredList = await env.ATTENDANCE_KV.list({ prefix: "registered_name_" });
      const groupMap = {};
      for (const key of registeredList.keys) {
        const name = await env.ATTENDANCE_KV.get(key.name);
        const memberId = key.name.replace("registered_name_", "");
        const group = await getUserGroup(memberId, env);
        if (!groupMap[group]) groupMap[group] = [];
        groupMap[group].push(name);
      }
      const groups = Object.keys(groupMap).sort();
      if (groups.length === 0) {
        response = `\u274C No members found.`;
      } else {
        response = `\u{1F465} *Members by Group:*

`;
        for (const group of groups) {
          response += `\u{1F4CC} *${group}* (${groupMap[group].length})
`;
          response += groupMap[group].map((n) => `\u2022 ${n}`).join("\n");
          response += `

`;
        }
      }
    }
  } else if (text.startsWith("/addmember")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const name = text.substring(11).trim();
      if (!name) {
        response = `Usage: \`/addmember James Wong\``;
      } else {
        const memberKey = `nontelegram:${name}`;
        await env.ATTENDANCE_KV.put(`registered_name_${memberKey}`, name);
        await env.ATTENDANCE_KV.put(`name_${memberKey}`, name);
        response = `\u2705 Added *${name}* as a non-Telegram member!

To assign a group: \`/assigngroup ${name} [Group Name]\``;
      }
    }
  } else if (text.startsWith("/removemember")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const name = text.substring(13).trim();
      if (!name) {
        response = `Usage: \`/removemember James Wong\``;
      } else {
        const memberKey = `nontelegram:${name}`;
        const exists = await env.ATTENDANCE_KV.get(`registered_name_${memberKey}`) || await env.ATTENDANCE_KV.get(`name_${memberKey}`);
        if (!exists) {
          response = `\u274C Member "${name}" not found.`;
        } else {
          await env.ATTENDANCE_KV.delete(`registered_name_${memberKey}`);
          await env.ATTENDANCE_KV.delete(`name_${memberKey}`);
          await env.ATTENDANCE_KV.delete(`group_${memberKey}`);
          const allEvents = await getAllEvents(env);
          for (const event of allEvents) {
            await env.ATTENDANCE_KV.delete(`attendance_${event.id}_${memberKey}`);
          }
          response = `\u2705 Removed *${name}* from member list.`;
        }
      }
    }
  } else if (text === "/allmembers") {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const registeredList = await env.ATTENDANCE_KV.list({ prefix: "registered_name_" });
      const telegramMembers = [], nonTeleMembers = [];
      for (const key of registeredList.keys) {
        const name = await env.ATTENDANCE_KV.get(key.name);
        if (key.name.includes("nontelegram:")) nonTeleMembers.push(name);
        else telegramMembers.push(name);
      }
      response = `\u{1F465} *All Members*

`;
      response += `\u{1F4F1} *Telegram (${telegramMembers.length}):*
`;
      response += telegramMembers.map((m) => `\u2022 ${m}`).join("\n") || "\u2022 None";
      response += `

\u{1F4DD} *Non-Telegram (${nonTeleMembers.length}):*
`;
      response += nonTeleMembers.map((m) => `\u2022 ${m}`).join("\n") || "\u2022 None";
      response += `

\u{1F4CA} *Total: ${telegramMembers.length + nonTeleMembers.length}*`;
    }
  } else if (text.startsWith("/export")) {
    const isLeaderUser = await isLeader(userId, env);
    if (!isLeaderUser) {
      response = `\u274C Leaders only.`;
    } else {
      const args = text.substring(7).trim();
      let eventsToExport = [];
      if (args) {
        const event = await getEvent(args, env);
        if (!event) {
          response = `\u274C Event "${args}" not found.`;
        } else {
          eventsToExport = [event];
        }
      } else {
        eventsToExport = await getAllEvents(env);
      }
      if (!response) {
        let csv = `Event,Date,Time,Member Name,Group,Status
`;
        for (const event of eventsToExport) {
          const prefix = `attendance_${event.id}_`;
          const list = await env.ATTENDANCE_KV.list({ prefix });
          for (const key of list.keys) {
            const status = await env.ATTENDANCE_KV.get(key.name);
            const memberId = key.name.replace(prefix, "");
            let memberName = await env.ATTENDANCE_KV.get(`registered_name_${memberId}`);
            if (!memberName) memberName = await env.ATTENDANCE_KV.get(`name_${memberId}`);
            const group = await getUserGroup(memberId, env);
            csv += `"${event.name}","${event.date}","${event.time}","${memberName}","${group}","${status}"
`;
          }
        }
        const preview = csv.substring(0, 3e3);
        const truncated = csv.length > 3e3 ? "\n_(truncated \u2014 full data has more rows)_" : "";
        response = `\`\`\`
${preview}
\`\`\`${truncated}`;
      }
    }
  } else if (text.startsWith("/newevent")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const args = text.substring(10).trim();
      const pipeIndex = args.indexOf("|");
      if (!args) {
        response = `Usage:
\`/newevent [id] [name] | [date] | [time]\`

Example:
\`/newevent camp2026 June Camp | 21 June 2026 (Sun) | 9:00am\`

_For weekly Nav+U, the default event auto-updates each week._`;
      } else if (pipeIndex === -1) {
        const parts = args.split(" ");
        const eventId = parts[0];
        const eventName = parts.slice(1).join(" ") || "New Event";
        const event = {
          id: eventId,
          name: eventName,
          date: getCurrentWeekFriday(),
          time: "5:30pm",
          active: true,
          created: getDateKey()
        };
        await saveEvent(event, env);
        response = `\u2705 Event created!

*${eventName}*
ID: \`${eventId}\`
\u{1F4C5} ${event.date} at ${event.time}

To update date/time:
/setdate ${eventId} [date]
/settime ${eventId} [time]`;
      } else {
        const beforePipe = args.substring(0, pipeIndex).trim();
        const afterPipes = args.substring(pipeIndex + 1).split("|");
        const parts = beforePipe.split(" ");
        const eventId = parts[0];
        const eventName = parts.slice(1).join(" ") || "New Event";
        const eventDate = afterPipes[0] ? afterPipes[0].trim() : getCurrentWeekFriday();
        const eventTime = afterPipes[1] ? afterPipes[1].trim() : "5:30pm";
        const event = {
          id: eventId,
          name: eventName,
          date: eventDate,
          time: eventTime,
          active: true,
          created: getDateKey()
        };
        await saveEvent(event, env);
        response = `\u2705 Event created!

*${eventName}*
ID: \`${eventId}\`
\u{1F4C5} ${eventDate} at ${eventTime}`;
      }
    }
  } else if (text.startsWith("/cancelevent")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const eventId = text.substring(13).trim();
      if (!eventId) {
        response = `Usage: \`/cancelevent [eventId]\`
Use /events to see event IDs.`;
      } else {
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          event.active = false;
          await saveEvent(event, env);
          response = `\u274C *${event.name}* has been cancelled.

Members will see a cancellation notice when they try to RSVP.`;
        }
      }
    }
  } else if (text.startsWith("/activateevent")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const eventId = text.substring(15).trim();
      if (!eventId) {
        response = `Usage: \`/activateevent [eventId]\``;
      } else {
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          event.active = true;
          await saveEvent(event, env);
          response = `\u2705 *${event.name}* is now active again!`;
        }
      }
    }
  } else if (text.startsWith("/clearevent")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const eventId = text.substring(12).trim();
      if (!eventId) {
        response = `Usage: \`/clearevent [eventId]\`
Use /events to see IDs.`;
      } else {
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          const prefix = `attendance_${eventId}_`;
          const list = await env.ATTENDANCE_KV.list({ prefix });
          for (const key of list.keys) {
            await env.ATTENDANCE_KV.delete(key.name);
          }
          const tempList = await env.ATTENDANCE_KV.list({ prefix: "temp_event_" });
          for (const key of tempList.keys) {
            const val = await env.ATTENDANCE_KV.get(key.name);
            if (val === eventId) await env.ATTENDANCE_KV.delete(key.name);
          }
          response = `\u{1F5D1}\uFE0F Attendance cleared for *${event.name}*!`;
        }
      }
    }
  } else if (text.startsWith("/deleteevent")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const eventId = text.substring(13).trim();
      if (!eventId) {
        response = `Usage: \`/deleteevent [eventId]\``;
      } else {
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          const prefix = `attendance_${eventId}_`;
          const list = await env.ATTENDANCE_KV.list({ prefix });
          for (const key of list.keys) {
            await env.ATTENDANCE_KV.delete(key.name);
          }
          await env.ATTENDANCE_KV.delete(`event_${eventId}`);
          response = `\u{1F5D1}\uFE0F Event *${event.name}* and all its attendance records have been deleted.`;
        }
      }
    }
  } else if (text.startsWith("/setdate")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const args = text.substring(9).trim();
      const parts = args.split(" ");
      if (parts.length < 2) {
        response = `Usage: \`/setdate [eventId] [date]\`
Example: \`/setdate default 27 June 2026 (Fri)\``;
      } else {
        const eventId = parts[0];
        const newDate = parts.slice(1).join(" ");
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found. Use /events to see IDs.`;
        } else {
          event.date = newDate;
          await saveEvent(event, env);
          response = `\u2705 *${event.name}* date updated to: ${newDate}`;
        }
      }
    }
  } else if (text.startsWith("/settime")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const args = text.substring(9).trim();
      const parts = args.split(" ");
      if (parts.length < 2) {
        response = `Usage: \`/settime [eventId] [time]\`
Example: \`/settime default 7:00pm\``;
      } else {
        const eventId = parts[0];
        const newTime = parts.slice(1).join(" ");
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          event.time = newTime;
          await saveEvent(event, env);
          response = `\u2705 *${event.name}* time updated to: ${newTime}`;
        }
      }
    }
  } else if (text.startsWith("/setname")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const args = text.substring(9).trim();
      const parts = args.split(" ");
      if (parts.length < 2) {
        response = `Usage: \`/setname [eventId] [name]\`
Example: \`/setname default Weekly Nav+U\``;
      } else {
        const eventId = parts[0];
        const newName = parts.slice(1).join(" ");
        const event = await getEvent(eventId, env);
        if (!event) {
          response = `\u274C Event "${eventId}" not found.`;
        } else {
          event.name = newName;
          await saveEvent(event, env);
          response = `\u2705 Event renamed to: *${newName}*`;
        }
      }
    }
  } else if (text.startsWith("/autodate")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const eventId = text.substring(10).trim() || "default";
      const event = await getEvent(eventId, env);
      if (!event) {
        response = `\u274C Event "${eventId}" not found.`;
      } else {
        event.date = getCurrentWeekFriday();
        await saveEvent(event, env);
        response = `\u2705 *${event.name}* date reset to auto: ${event.date}`;
      }
    }
  } else if (text.startsWith("/approve")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const targetId = text.substring(8).trim();
      if (!targetId) {
        response = `Usage: \`/approve 987654321\``;
      } else {
        const userIdToApprove = parseInt(targetId);
        if (isNaN(userIdToApprove)) {
          response = `\u274C Invalid user ID.`;
        } else {
          await approveUser(userIdToApprove, env);
          const name = await env.ATTENDANCE_KV.get(`registered_name_${userIdToApprove}`);
          response = `\u2705 User ${targetId} approved!${name ? ` (${name})` : ""}`;
        }
      }
    }
  } else if (text.startsWith("/unapprove")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const targetId = text.substring(11).trim();
      if (!targetId) {
        response = `Usage: \`/unapprove 987654321\``;
      } else {
        const userIdToUnapprove = parseInt(targetId);
        if (isNaN(userIdToUnapprove)) {
          response = `\u274C Invalid user ID.`;
        } else {
          await removeApprovedUser(userIdToUnapprove, env);
          const name = await env.ATTENDANCE_KV.get(`registered_name_${userIdToUnapprove}`);
          response = `\u2705 User ${targetId} unapproved.${name ? ` (${name})` : ""}`;
        }
      }
    }
  } else if (text.startsWith("/setinvite")) {
    const isAdminUser = await isAdmin(userId, env);
    if (!isAdminUser) {
      response = `\u274C Admin only.`;
    } else {
      const newCode = text.substring(11).trim();
      if (!newCode) {
        response = `Usage: \`/setinvite NEWCODE123\``;
      } else {
        await env.ATTENDANCE_KV.put("invite_code_override", newCode);
        response = `\u2705 Invite code updated to: \`${newCode}\`

Share this with new members.`;
      }
    }
  } else if (text.startsWith("/")) {
    response = "\u274C Unknown command. Type /start to see available commands.";
  }
  if (response) {
    await sendMessage(chatId, response, env.BOT_TOKEN);
  }
}
__name(handleUpdate, "handleUpdate");
async function saveAttendanceHistory(userId, eventId, status, env) {
  await env.ATTENDANCE_KV.put(`history_${userId}_${eventId}`, status);
}
__name(saveAttendanceHistory, "saveAttendanceHistory");
var index_default = {
  async fetch(request, env) {
    return await handleRequest(request, env);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
