/** The Google Apps Script an owner pastes into a site's rota sheet (Extensions → Apps Script). */
export function rotaScript(url: string, token: string, siteName: string): string {
  return `// PHO & CO Ops Hub: sends the ${siteName} rota to the app.
// Paste into Extensions > Apps Script, Save, then run "setUp" once and allow access.
// Only the Export, Settings (week status) and Staff tabs are read. Nothing in this sheet is changed.
const OPS_HUB_URL = "${url}";
const OPS_HUB_TOKEN = "${token}"; // keep private: anyone with this can send a rota for ${siteName}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Ops Hub").addItem("Send rota to Ops Hub now", "sendRotaNow").addToUi();
}

function setUp() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === "sendRota"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendRota").timeBased().everyHours(1).create();
  sendRotaNow();
}

function sendRotaNow() {
  var r = sendRota();
  var msg = r.ok ? "Sent: " + r.shifts + " shifts (" + r.added + " new, " + r.changed + " changed, " + r.cancelled + " cancelled), " + r.messages + " messages."
                 : "Not sent: " + (r.error || "unknown error");
  if (r.issues && r.issues.length) msg += "\\n\\nPlease check:\\n- " + r.issues.slice(0, 8).join("\\n- ");
  SpreadsheetApp.getUi().alert("Ops Hub", msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function sendRota() {
  var ss = SpreadsheetApp.getActive();
  var exp = ss.getSheetByName("Export").getDataRange().getDisplayValues()
    .filter(function (row, i) { return i === 0 || row[4] !== ""; })
    .map(function (row) { return row.slice(0, 31); });
  var payload = {
    export: exp,
    weeks: ss.getSheetByName("Settings").getRange("A13:H200").getDisplayValues(),
    staff: ss.getSheetByName("Staff").getDataRange().getDisplayValues().map(function (row) { return row.slice(0, 10); })
  };
  var res = UrlFetchApp.fetch(OPS_HUB_URL, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + OPS_HUB_TOKEN }, payload: JSON.stringify(payload)
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: "HTTP " + res.getResponseCode() }; }
}
`;
}
