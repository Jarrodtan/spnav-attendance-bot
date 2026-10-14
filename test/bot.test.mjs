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

let last = null, msgId = 100, deleted = [];
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (url.includes("sendMessage") || url.includes("editMessageText")) last = body;
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
await tap(1, "newev_1"); await say(1, "Sat 18 Oct, 9am");
check(buttons().includes("evskiploc"), "asks location with skip");
await say(1, "SP Chapel");
check(last.text.includes("Prayer Walk") && last.text.includes("Added") && last.text.includes("📍 SP Chapel"), "preset event created with location");
// Custom event
await tap(1, "input_new_event_name"); await say(1, "Camp"); await say(1, "Dec 1-3"); await tap(1, "evskiploc");
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
await tap(3, "input_add_member_name"); await say(3, "James Wong"); await tap(3, "add_member_group_rescuer");
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
await tap(3, "screen_whatsapp"); check(last.text.includes("📍 SP Chapel") && last.text.includes("Prayer Walk") && !last.text.includes("Camp"), "whatsapp skips cancelled");

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

console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
