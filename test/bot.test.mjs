// Simulated tests: fake KV + Telegram, drive the Worker with webhook updates.
// Run: npm test
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

// src/index.js is an ES module in a .js file; copy it to .mjs so Node loads it as ESM
const src = new URL("../src/index.js", import.meta.url);
const copy = join(mkdtempSync(join(tmpdir(), "spnav-")), "bot.mjs");
writeFileSync(copy, readFileSync(src, "utf8"));
const bot = (await import(pathToFileURL(copy).href)).default;

const store = new Map();
const KV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })) }; }
};
const env = { ATTENDANCE_KV: KV, BOT_TOKEN: "T", ADMIN_USER_ID: "1", ADMIN_PASSWORD: "ap", LEADER_PASSWORD: "lp", INVITE_CODE: "inv" };

let last = null, msgId = 100, deleted = [], history = [];
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (url.includes("sendMessage") || url.includes("editMessageText")) { last = body; history.push(body); }
  if (url.includes("deleteMessage")) deleted.push(body.message_id);
  if (body.reply_markup) for (const row of body.reply_markup.inline_keyboard) for (const b of row)
    if (Buffer.byteLength(b.callback_data) > 64) throw new Error("callback too long: " + b.callback_data);
  return { json: async () => ({ ok: true, result: { message_id: ++msgId } }) };
};

const post = u => bot.fetch(new Request("https://x/webhook/T", { method: "POST", body: JSON.stringify(u) }), env);
const tap = (uid, data) => post({ callback_query: { id: "c", from: { id: uid, first_name: "U" + uid }, message: { chat: { id: uid }, message_id: 5 }, data } });
const say = (uid, text) => post({ message: { chat: { id: uid }, message_id: 9, from: { id: uid, first_name: "U" + uid }, text } });
const buttons = () => last.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
const check = (c, m) => { if (!c) { console.log("FAIL:", m, "\n", last && last.text); process.exitCode = 1; } else console.log("ok -", m); };

// Migration from old single-event keys
store.set("event_name", "Weekly Nav+U"); store.set("event_date", "17 Oct"); store.set("rsvp_2", "coming");
// Admin (1) and member (2) registered
for (const [id, n] of [[1, "Admin"], [2, "Mem"], [3, "Lead"]]) { store.set(`name_${id}`, n); store.set(`approved_${id}`, "true"); store.set(`main_msg_${id}`, "5"); }
store.set("role_1", "admin"); store.set("role_3", "leader");

await tap(2, "screen_home");
check(last.text.includes("Weekly Nav+U") && last.text.includes("17 Oct"), "old event migrated to home screen");
check(!store.has("rsvp_2") && !store.has("event_name"), "old keys cleaned up");
const ev1 = JSON.parse(store.get("events"))[0].id;

// Admin adds Prayer Walk via preset
await tap(1, "screen_events"); check(buttons().includes("screen_add_event"), "manage events screen");
await tap(1, "screen_add_event"); check(buttons().includes("newev_1"), "presets shown");
await tap(1, "newev_1"); check(buttons().includes("newaud_hesed"), "asks who the event is for"); await tap(1, "newaud_both"); await say(1, "Sat 18 Oct, 9am");
check(buttons().includes("evskiploc"), "asks location with skip");
await say(1, "SP Chapel");
check(last.text.includes("Prayer Walk") && last.text.includes("Added") && last.text.includes("📍 SP Chapel"), "preset event created with location");
// Custom event
await tap(1, "input_new_event_name"); await say(1, "Camp"); await tap(1, "newaud_both"); await say(1, "Dec 1-3"); await tap(1, "evskiploc");
const events = JSON.parse(store.get("events"));
check(events.length === 3 && events[2].name === "Camp" && events[2].when === "Dec 1-3", "custom event created");
const [, ev2, ev3] = events.map(e => e.id);

// Member sees all events, RSVPs to two
await tap(2, "screen_home");
check(["Weekly Nav+U", "Prayer Walk", "Camp"].every(n => last.text.includes(n)), "home lists all events");
check(last.text.includes("📍 SP Chapel") && (last.text.match(/📍/g) || []).length === 1, "location shown only where set");
check(!buttons().includes("screen_rsvp") && !buttons().includes("screen_status"), "no separate RSVP/status button");
await tap(2, `rsvp_y_${ev1}`); check(last.text.includes("Marked *COMING*") && last.text.includes("You're *COMING*"), "one-tap RSVP coming");
await tap(2, `rsvp_n_${ev2}`); check(store.get(`rsvp_${ev2}_2`) === "notcoming", "RSVP not coming stored per event");

// Member can't manage events
await tap(2, "screen_events"); check(last.text.includes("Admin only"), "member blocked from events");
await tap(2, `evdel_${ev1}`); check(JSON.parse(store.get("events")).length === 3, "member cannot delete event");

// Admin edits event
await tap(1, `evwhen_${ev1}`); await say(1, "Fri 24 Oct, 6pm");
check(JSON.parse(store.get("events"))[0].when === "Fri 24 Oct, 6pm", "date & time edited in one input");
await tap(1, `evname_${ev1}`); await say(1, "Nav+U Special");
check(JSON.parse(store.get("events"))[0].name === "Nav+U Special", "event renamed");
await tap(1, `evoff_${ev3}`);
await tap(2, "screen_home"); check(last.text.includes("Cancelled") && !buttons().includes(`rsvp_y_${ev3}`), "cancelled event shown without RSVP buttons");
await tap(2, `rsvp_y_${ev3}`); check(!store.has(`rsvp_${ev3}_2`), "can't RSVP cancelled event");

// Leader: non-telegram member + mark attendance
await tap(3, "input_add_member_name"); await say(3, "James Wong"); await tap(3, "add_member_group_1");
await tap(3, "screen_mark_attendance"); check(buttons().includes(`markev_${ev1}`) && buttons().includes(`markev_${ev2}`), "event picker for marking");
await tap(3, `markev_${ev2}`); check(buttons().includes(`mm_${ev2}_nontelegram:James Wong`), "member list for event");
await tap(3, `mm_${ev2}_nontelegram:James Wong`);
await tap(3, `sa_c_${ev2}_nontelegram:James Wong`); check(store.get(`rsvp_${ev2}_nontelegram:James Wong`) === "coming", "leader marked attendance");

// List / WhatsApp
await tap(3, "screen_list"); check(last.text.includes("Nav+U Special") && last.text.includes("Mem (2)") && last.text.includes("James Wong"), "combined list");
await tap(1, `evloc_${ev1}`); await say(1, "Room 5");
check(JSON.parse(store.get("events"))[0].location === "Room 5", "location edited");
await tap(1, `evloc_${ev1}`); await say(1, "-");
check(JSON.parse(store.get("events"))[0].location === "", "location cleared with -");
const lines = (...a) => a.join(String.fromCharCode(10));
await tap(3, "screen_whatsapp"); check(last.text.includes("- SP Chapel") && last.text.includes(lines("_Rescuer_", "1. James Wong", "2. ")) && last.text.includes("✝️") && last.text.includes("Prayer Walk") && !last.text.includes("Camp"), "whatsapp skips cancelled");

// Clear + delete event
await tap(1, `evclr_${ev1}`); check(!store.has(`rsvp_${ev1}_2`), "clear RSVPs for one event");
check(store.get(`rsvp_${ev2}_2`) === "notcoming", "other event RSVPs kept");
await tap(1, `evdel_${ev2}`); check(JSON.parse(store.get("events")).length === 2 && ![...store.keys()].some(k => k.startsWith(`rsvp_${ev2}_`)), "delete event + its RSVPs");

// Remove member clears their RSVPs
await tap(2, `rsvp_y_${ev1}`);
await tap(1, "remove_member_2"); check(!store.has("name_2") && !store.has(`rsvp_${ev1}_2`), "remove member clears RSVPs");

// Old buttons gone
await tap(1, "screen_home"); check(!buttons().some(b => /week_mode|action_clear|autodate|event_settings/.test(b)), "week mode / auto date / clear gone");
// Stray text is deleted and changes nothing
const before = JSON.stringify([...store]); deleted = [];
await say(2, "hello bot");
check(deleted.includes(9) && JSON.stringify([...store]) === before, "random text deleted, no data changed");

// Photos / files / stickers are deleted too
deleted = [];
await post({ message: { chat: { id: 2 }, message_id: 11, from: { id: 2, first_name: "U2" }, photo: [{ file_id: "x" }] } });
check(deleted.includes(11), "photo deleted");

// Member changes own group; WhatsApp groups by ministry group in fixed order
store.set("name_4", "Zed"); store.set("approved_4", "true"); store.set("group_4", "Not sure"); store.set("main_msg_4", "5");
await tap(4, "screen_profile"); check(buttons().includes("screen_my_group"), "profile has change group");
await tap(4, "screen_my_group"); check(buttons().includes("mygrp_ns") && buttons().includes("mygrp_4"), "group picker incl. Not sure");
await tap(4, "mygrp_4"); check(store.get("group_4") === "Recharger" && last.text.includes("Recharger"), "member changed own group");
await tap(4, `rsvp_y_${ev1}`);
store.set("name_5", "Amy"); store.set("group_5", "Recharger"); store.set(`rsvp_${ev1}_5`, "coming");
store.set("name_6", "Bob"); store.set("group_6", "Refresher"); store.set(`rsvp_${ev1}_6`, "notcoming");
await tap(3, "screen_whatsapp");
check(last.text.includes(lines("_Recharger_", "1. Amy", "2. Zed", "3. ")) &&!last.text.includes("Bob"), "whatsapp sorted by group, coming only");
check(last.text.indexOf("_Refresher_") < last.text.indexOf("_Recharger_"), "group order fixed");
await tap(3, "wafoot_restorer"); await say(3, "See you!");
check(last.text.includes("See you!") && !last.text.includes("✝️"), "footer customised");
await tap(3, "wafoot_restorer"); await say(3, "-");
check(store.get("wa_footer_restorer") === "", "footer removed with -");

// Chosen RSVP is marked; login lives in My Profile, not home
store.set("role_4", "member");
await tap(4, "screen_home");
check(last.reply_markup.inline_keyboard.flat().some(b => b.text.startsWith("👉 ✅")), "chosen RSVP marked with 👉");
check(!buttons().includes("screen_login"), "no login button on member home");
await tap(4, "screen_profile"); check(buttons().includes("screen_login"), "login button in My Profile");
await tap(4, "screen_login"); check(buttons().includes("screen_profile"), "login back goes to profile");

// Names with _ and * are escaped for Telegram Markdown
store.set("name_4", "wei_liang*");
await tap(4, "screen_home");
check(last.text.includes("wei*\\_*liang*\\**"), "underscore/asterisk escaped in bold name");

// If Telegram still rejects the formatting, the screen is resent as plain text
const realFetch = globalThis.fetch; let plainRetry = false;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (url.includes("editMessageText") && body.parse_mode) return { json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }) };
  if (url.includes("editMessageText")) plainRetry = true;
  return realFetch(url, opts);
};
await tap(4, "screen_home"); check(plainRetry, "falls back to plain text on parse error");
globalThis.fetch = realFetch;

// Invite code: admin can view and change it in the bot
await tap(1, "screen_home"); check(buttons().includes("screen_invite_code"), "admin has invite code button");
await tap(1, "screen_invite_code"); check(last.text.includes("inv"), "shows current code");
await tap(4, "input_invite_code_set"); check(store.get("input_pending_4") === undefined, "member can't change code");
await tap(1, "input_invite_code_set"); await say(1, "has space");
check(!store.has("invite_code"), "code with spaces rejected");
await tap(1, "input_invite_code_set"); await say(1, "NEW123");
check(store.get("invite_code") === "NEW123", "invite code changed");
store.set("main_msg_7", "5");
await tap(7, "input_invite_code"); await say(7, "inv");
check(last.text.includes("Wrong invite code"), "old code rejected");
await tap(7, "input_invite_code"); await say(7, "NEW123");
check(last.text.includes("Valid code"), "new code accepted");

// ===== Teams: Restorer (brothers) / Hesed (sisters) =====
const evs = () => JSON.parse(store.get("events"));
// Admin adds a Hesed-only event
await tap(1, "newev_0"); await tap(1, "newaud_hesed"); await say(1, "Sat 25 Oct, 2pm"); await tap(1, "evskiploc");
const hesedEv = evs().find(e => e.team === "hesed");
check(hesedEv && hesedEv.name === "Weekly Nav+U", "admin created Hesed-only event");

// New sister registers: name -> team -> (Hesed has no groups) done
store.delete("invite_code");
store.set("main_msg_8", "5");
await tap(8, "input_invite_code"); await say(8, "inv"); await say(8, "Grace Tan");
check(buttons().includes("regteam_hesed") && buttons().includes("regteam_restorer"), "registration asks team");
await tap(8, "regteam_hesed");
check(store.get("team_8") === "hesed" && store.get("group_8") === "-" && store.get("name_8") === "Grace Tan", "sister registered without group");
check(history.some(m => m.chat_id === 8 && m.text.includes("Team: *👩 Hesed*")) && history.some(m => m.text.includes("New member registered") && m.text.includes("Team: 👩 Hesed")), "welcome + admin alert show team");
await tap(8, "screen_home");
check(last.text.includes("Sat 25 Oct") && !buttons().some(b => b === `rsvp_y_${ev3}` ) , "sister sees Hesed event");
const brotherOnly = evs().find(e => e.team === "hesed");
await tap(4, "screen_home"); check(!last.text.includes("Sat 25 Oct"), "brother doesn't see Hesed-only event");
await tap(4, `rsvp_y_${hesedEv.id}`); check(!store.has(`rsvp_${hesedEv.id}_4`), "brother can't RSVP Hesed-only event");
await tap(8, `rsvp_y_${hesedEv.id}`); check(store.get(`rsvp_${hesedEv.id}_8`) === "coming", "sister RSVPs");
await tap(8, "screen_profile"); check(last.text.includes("Hesed") && !buttons().includes("screen_my_group"), "no Change Group when team has no groups");

// Admin edits Hesed groups; brother registering still gets Restorer groups
await tap(1, "screen_groups"); await tap(1, "grps_hesed"); check(last.text.includes("No groups"), "Hesed starts with no groups");
await tap(1, "grpadd_hesed"); await say(1, "Group 1");
await tap(1, "grpadd_hesed"); await say(1, "Group 2");
check(JSON.parse(store.get("groups_hesed")).join() === "Group 1,Group 2", "admin added Hesed groups");
await tap(1, "grpdel_hesed_1"); check(JSON.parse(store.get("groups_hesed")).join() === "Group 1", "admin deleted a group");
await tap(8, "screen_my_group"); await tap(8, "mygrp_0"); check(store.get("group_8") === "Group 1", "sister picks Group 1");

// Hesed leader: own team only
store.set("name_9", "Hannah"); store.set("approved_9", "true"); store.set("team_9", "hesed"); store.set("role_9", "leader"); store.set("main_msg_9", "5");
await tap(9, "screen_list");
check(last.text.includes("Grace Tan") && !last.text.includes("Zed") && last.text.includes("Hesed"), "Hesed leader list = sisters only");
await tap(9, "screen_whatsapp");
check(last.text.includes("WhatsApp Summary — 👩 Hesed") && last.text.includes("Group 1") && last.text.includes("Grace Tan") && !last.text.includes("Zed"), "Hesed WhatsApp = sisters only");
await tap(9, "wafmt_restorer"); check(!last.text.includes("Restorer"), "Hesed leader can't open Restorer settings");
await tap(9, "screen_remove_member"); check(!buttons().includes("remove_member_4") && buttons().includes("remove_member_8"), "Hesed leader only removes sisters");
await tap(9, "remove_member_4"); check(store.has("name_4"), "Hesed leader can't remove a brother");

// Admin: list split by team, WhatsApp asks team
await tap(1, "screen_list"); check(last.text.includes("_👨 Restorer_") && last.text.includes("_👩 Hesed_"), "admin list split by team");
await tap(1, "screen_whatsapp"); check(buttons().includes("wa_hesed") && buttons().includes("wa_restorer"), "admin picks team for WhatsApp");

// WhatsApp formats
await tap(9, "wafmtset_hesed_split");
check(last.text.includes("✅ *Coming (1)*") && last.text.includes("❌ *Not Coming (0)*"), "split format");
await tap(9, "wafmtset_hesed_simple");
check(last.text.includes(lines("- Sat 25 Oct, 2pm", "", "1. Grace Tan", "2. ")), "simple format");
await tap(9, "wafmtset_hesed_custom"); check(buttons().includes("watpl_hesed"), "custom shows Edit Template");
await tap(9, "watpl_hesed"); await say(9, lines("Hesed {event} — {date}", "Coming ({coming_count}):", "{coming}", "Loc: {location}"));
check(last.text.includes(lines("Hesed Weekly Nav+U — Sat 25 Oct, 2pm", "Coming (1):", "1. Grace Tan")), "custom template filled");
check(store.get("wa_format_restorer") === undefined, "Restorer format unchanged");

// Admin adds a non-Telegram sister (team asked first)
await tap(1, "input_add_member_name"); await say(1, "Ruth");
check(buttons().includes("amteam_hesed"), "admin picks team for new member");
await tap(1, "amteam_hesed"); await tap(1, "add_member_group_0");
check(store.get("team_nontelegram:Ruth") === "hesed" && store.get("group_nontelegram:Ruth") === "Group 1", "non-Telegram sister added");

// Member changes team
await tap(4, "screen_my_team"); await tap(4, "myteam_hesed");
check(store.get("team_4") === "hesed" && store.get("group_4") === "Not sure", "member changed team, group reset");

// Existing members/events default to Restorer / both
check(evs().filter(e => !e.team || e.team === "both").length >= 1, "old events stay for both teams");

// ===== Emojis =====
await tap(1, "screen_home");
check(/^(🌅 Good morning|☀️ Good afternoon|🌙 Good evening), /.test(last.text), "time-of-day greeting");
check(last.text.includes("📖 *Nav+U Special*"), "Nav+U gets 📖");
await tap(1, "screen_events");
check(last.reply_markup.inline_keyboard.flat().some(b => b.text.startsWith("⛔ Camp")), "cancelled event shows ⛔");
await tap(1, "screen_add_event");
check(["📖 Weekly Nav+U", "🙏 Prayer Walk", "🏕️ VTP"].every(t => last.reply_markup.inline_keyboard.flat().some(b => b.text === t)), "preset emojis");
await tap(1, `evemo_${ev1}`); await tap(1, `evemoset_${ev1}_4`);
check(evs().find(e => e.id === ev1).emoji === "🎉", "admin picked event emoji");
await tap(1, `evemoset_${ev1}_auto`); check(!evs().find(e => e.id === ev1).emoji, "emoji back to automatic");
await tap(5, `rsvp_y_${ev1}`); check(last.text.startsWith("🙌"), "🙌 on coming");
await tap(5, `rsvp_n_${ev1}`); check(last.text.startsWith("😢"), "😢 on not coming");
await tap(1, "screen_whatsapp"); check(buttons().includes("wa_restorer") && last.reply_markup.inline_keyboard.flat().some(b => b.text === "👨 Restorer"), "team emoji on buttons");

console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
