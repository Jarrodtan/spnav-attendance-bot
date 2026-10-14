// Tests apps-script/Code.gs against a fake Google Sheet.
// Run: npm test
import { readFileSync } from "fs";
import vm from "vm";

const code = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
let failed = false;
const check = (c, m) => { console.log((c ? "ok - " : "FAIL: ") + m); if (!c) failed = true; };

// Minimal in-memory sheet: grid[row][col], 0-based internally, 1-based API like Apps Script
function makeSheet(rows) {
  const grid = rows.map(r => [...r]);
  const lastRow = () => { let n = grid.length; while (n > 0 && grid[n - 1].every(v => v === "" || v == null)) n--; return n; };
  const lastCol = () => Math.max(0, ...grid.map(r => { let n = r.length; while (n > 0 && (r[n - 1] === "" || r[n - 1] == null)) n--; return n; }));
  const cell = (r, c) => (grid[r] && grid[r][c] != null ? grid[r][c] : "");
  const set = (r, c, v) => { while (grid.length <= r) grid.push([]); grid[r][c] = v; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
    getValue: () => cell(r - 1, c - 1),
    setValues: v => { v.forEach((row, i) => row.forEach((x, j) => set(r - 1 + i, c - 1 + j, x))); return range(r, c, nr, nc); },
    setValue: v => { set(r - 1, c - 1, v); return range(r, c, nr, nc); },
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(r - 1 + i, c - 1 + j, ""); return range(r, c, nr, nc); },
    setNumberFormat: () => range(r, c, nr, nc),
    setFontWeight: () => range(r, c, nr, nc)
  });
  return {
    grid,
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getRange: range,
    getDataRange: () => range(1, 1, lastRow(), lastCol()),
    appendRow: v => { grid.splice(lastRow(), 0, [...v]); },
    deleteRow: r => { grid.splice(r - 1, 1); }
  };
}

function run(sheet, body) {
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "s3cret" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: "json" } }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.doPost({ postData: { contents: JSON.stringify({ secret: "s3cret", ...body }) } });
}

const NEW = ["S/N", "Name (Registered with bot)", "Team", "Ministry Group", "Telegram Username", "Telegram Display Name", "Date Joined", "User ID"];
const d1 = new Date("2026-08-01"), d2 = new Date("2026-09-01");

// 1. Original layout (A–G, no Team) is rearranged on first request
const old = makeSheet([
  ["S/N", "Name (Registered with bot)", "Telegram Display Name", "Telegram Username", "Ministry Group", "User ID", "Date Joined"],
  [1, "Wei Liang", "Jarrod", "@Jarrod99", "Repairer", "709711203", d1],
  [2, "Caleb", "Cal", "@cal", "Rescuer", "111", d2]
]);
check(run(old, { name: "Caleb", telegram: "Cal", username: "@cal", group: "Rescuer", team: "Restorer", userId: "111" }).success, "request succeeds on old layout");
check(JSON.stringify(old.grid[0]) === JSON.stringify(NEW), "headers moved to new order");
check(JSON.stringify(old.grid[1]) === JSON.stringify([1, "Wei Liang", "", "Repairer", "@Jarrod99", "Jarrod", d1.toJSON(), "709711203"].map((v, i) => i === 6 ? d1 : v)), "old row 1 mapped by header name");
check(old.grid[2][2] === "Restorer" && old.grid[2][3] === "Rescuer" && old.grid[2][7] === "111", "existing row updated with team in C");
check(old.getLastRow() === 3, "no duplicate row");

// 2. In-between layout (Team in H) also rearranged
const mid = makeSheet([
  ["S/N", "Name (Registered with bot)", "Telegram Display Name", "Telegram Username", "Ministry Group", "User ID", "Date Joined", "Team"],
  [1, "Grace", "G", "@g", "-", "222", d1, "Hesed"]
]);
run(mid, { action: "sync", members: [{ userId: "222", name: "Grace", group: "-", team: "Hesed" }] });
check(JSON.stringify(mid.grid[0]) === JSON.stringify(NEW), "Team-in-H layout rearranged");
check(mid.grid[1][2] === "Hesed" && mid.grid[1][4] === "@g" && mid.grid[1][5] === "G" && mid.grid[1][7] === "222", "values kept in right columns");
check(mid.getLastColumn() === 8, "no leftover 9th column");

// 3. Insert, update, delete, sync on the new layout
const s = makeSheet([NEW]);
run(s, { name: "Abner", telegram: "Ab", username: "@ab", group: "Refresher", team: "Restorer", userId: "1" });
run(s, { name: "Ruth", telegram: "-", username: "-", group: "Group 1", team: "Hesed", userId: "nontelegram:Ruth" });
check(s.getLastRow() === 3 && s.grid[1][0] === 1 && s.grid[2][0] === 2, "inserts numbered 1, 2");
check(s.grid[1][1] === "Abner" && s.grid[1][2] === "Restorer" && s.grid[1][3] === "Refresher" && s.grid[1][4] === "@ab" && s.grid[1][5] === "Ab" && Object.prototype.toString.call(s.grid[1][6]) === "[object Date]" && s.grid[1][7] === "1", "insert columns in new order");
run(s, { name: "Abner Ong", telegram: "Ab", username: "@ab", group: "Rescuer", team: "Restorer", userId: "1" });
check(s.grid[1][1] === "Abner Ong" && s.grid[1][3] === "Rescuer" && s.getLastRow() === 3, "update in place");
run(s, { action: "delete", userId: "1" });
check(s.getLastRow() === 2 && s.grid[1][1] === "Ruth" && s.grid[1][0] === 1, "delete + renumber");
const r = run(s, { action: "sync", members: [{ userId: "nontelegram:Ruth", name: "Ruth", group: "Group 1", team: "Hesed" }, { userId: "5", name: "Zed", group: "Rescuer", team: "Restorer" }] });
check(r.success && r.count === 2 && s.grid[2][1] === "Zed" && s.grid[2][4] === "-", "sync adds missing member");
check(run(s, { secret: "wrong", name: "x", userId: "9" }).error === "unauthorized", "wrong secret rejected");

console.log(failed ? "SOME FAILED" : "ALL PASSED");
if (failed) process.exitCode = 1;
