// Optional remote access through Firebase Realtime Database (free Spark plan).
//
// The unit only makes outbound HTTPS requests, so no router port forwarding is
// needed and the controller is never exposed to the internet. Everything here
// runs in its own low-priority task: a slow or dead internet link cannot delay
// the control task, and local safety never depends on the cloud.
//
// Data layout under /devices/<deviceId>/ (see docs/firebase-setup.md):
//   status            latest status, rewritten every few seconds
//   config            the settings currently in force
//   events/<push>     event history
//   history/<YYYYMMDD>/<HHMM>   level samples every 5 minutes (UTC)
//   commands/<id>     requests written by the phone app
//   results/<id>      the unit's answer to each request
#include "cloud.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "app.h"
#include "ca_certs.h"
#include "version.h"

namespace cloud {

namespace {
constexpr uint32_t kStatusPeriodMs = 5000;
constexpr uint32_t kCommandPeriodMs = 3000;
constexpr uint32_t kHistoryPeriodS = 300;
constexpr uint32_t kCommandMaxAgeS = 60;   // older requests are refused, never run late
constexpr int kHistoryKeepDays = 30;
constexpr size_t kMaxCommandBytes = 8192;

volatile State state = State::Disabled;

WiFiClientSecure dbClient;
HTTPClient dbHttp;
String idToken, refreshToken;
uint32_t tokenExpiresAtMs = 0;
String base;  // https://<db>/devices/<id>

// ---- HTTP helpers ---------------------------------------------------------

int dbRequest(const char* method, const String& path, const String& body, String* response = nullptr) {
  // print=silent stops Firebase echoing every write back, which would
  // otherwise use most of the free plan's monthly download allowance.
  const bool write = strcmp(method, "GET") != 0;
  const String url = base + path + (write ? ".json?print=silent&auth=" : ".json?auth=") + idToken;
  dbHttp.setReuse(true);
  dbHttp.setTimeout(8000);
  if (!dbHttp.begin(dbClient, url)) return -1;
  if (body.length()) dbHttp.addHeader("Content-Type", "application/json");
  const int code = dbHttp.sendRequest(method, body);
  if (code > 0 && response) {
    if (dbHttp.getSize() > static_cast<int>(kMaxCommandBytes)) {
      *response = "";
    } else {
      *response = dbHttp.getString();
    }
  }
  dbHttp.end();
  if (code == 401 || code == 403) idToken = "";  // sign in again
  return code;
}

bool dbOk(int code) { return code >= 200 && code < 300; }

bool authRequest(const String& url, const String& contentType, const String& body, JsonDocument& out) {
  WiFiClientSecure client;
  client.setCACert(kGoogleRootCas);
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", contentType);
  const int code = http.POST(body);
  const String payload = code > 0 ? http.getString() : String();
  http.end();
  if (code != 200) {
    Serial.printf("[cloud] auth request failed: %d\n", code);
    return false;
  }
  return !deserializeJson(out, payload);
}

bool signIn(const NetSettings& n) {
  JsonDocument req, res;
  req["email"] = n.fbEmail;
  req["password"] = n.fbPassword;
  req["returnSecureToken"] = true;
  String body;
  serializeJson(req, body);
  if (!authRequest("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + n.fbApiKey,
                   "application/json", body, res)) {
    return false;
  }
  idToken = res["idToken"] | "";
  refreshToken = res["refreshToken"] | "";
  const uint32_t lifetimeS = String(res["expiresIn"] | "3600").toInt();
  tokenExpiresAtMs = millis() + (lifetimeS > 600 ? lifetimeS - 300 : 300) * 1000UL;
  return !idToken.isEmpty();
}

bool refresh(const NetSettings& n) {
  JsonDocument res;
  if (!authRequest("https://securetoken.googleapis.com/v1/token?key=" + n.fbApiKey,
                   "application/x-www-form-urlencoded",
                   "grant_type=refresh_token&refresh_token=" + refreshToken, res)) {
    return false;
  }
  idToken = res["id_token"] | "";
  refreshToken = res["refresh_token"] | refreshToken.c_str();
  const uint32_t lifetimeS = String(res["expires_in"] | "3600").toInt();
  tokenExpiresAtMs = millis() + (lifetimeS > 600 ? lifetimeS - 300 : 300) * 1000UL;
  return !idToken.isEmpty();
}

bool ensureToken(const NetSettings& n) {
  if (!idToken.isEmpty() && static_cast<int32_t>(millis() - tokenExpiresAtMs) < 0) return true;
  if (!refreshToken.isEmpty() && refresh(n)) return true;
  return signIn(n);
}

// ---- Publishing -----------------------------------------------------------

bool pushStatus() {
  JsonDocument doc;
  app::fillStatus(doc.to<JsonObject>());
  doc["wifi"].remove("ip");  // the LAN address stays on the LAN
  doc["updatedAt"][".sv"] = "timestamp";
  String body;
  serializeJson(doc, body);
  return dbOk(dbRequest("PUT", "/status", body));
}

bool pushConfig() {
  JsonDocument doc;
  app::fillConfig(doc.to<JsonObject>());
  String body;
  serializeJson(doc, body);
  return dbOk(dbRequest("PUT", "/config", body));
}

// Sends events newer than `sentSeq`; stops at the first failure so nothing is skipped.
void pushEvents(uint32_t& sentSeq) {
  static LogEntry batch[8];
  const size_t n = app::copyLog(batch, 8, sentSeq);
  for (size_t i = 0; i < n; i++) {
    JsonDocument doc;
    app::fillEvent(doc.to<JsonObject>(), batch[i]);
    doc["at"][".sv"] = "timestamp";
    String body;
    serializeJson(doc, body);
    if (!dbOk(dbRequest("POST", "/events", body))) return;
    sentSeq = batch[i].seq;
  }
}

void dayKey(time_t t, char* out, size_t len) {
  struct tm tm;
  gmtime_r(&t, &tm);
  strftime(out, len, "%Y%m%d", &tm);
}

void pushHistory(uint32_t epoch) {
  JsonDocument status;
  app::fillStatus(status.to<JsonObject>());
  if (!(status["level"]["valid"] | false)) return;  // gaps stay gaps
  JsonDocument doc;
  doc["p"] = status["level"]["percent"];
  doc["v"] = (status["valve"]["commanded"] | false) ? 1 : 0;
  String body;
  serializeJson(doc, body);

  const time_t t = epoch;
  struct tm tm;
  gmtime_r(&t, &tm);
  char path[40];
  strftime(path, sizeof(path), "/history/%Y%m%d/%H%M", &tm);
  dbRequest("PUT", path, body);

  // Once per UTC day, drop the bucket that fell out of the retention window.
  static char lastPruned[12] = "";
  char today[12];
  dayKey(t, today, sizeof(today));
  if (strcmp(today, lastPruned) != 0) {
    char old[12];
    dayKey(t - static_cast<time_t>(kHistoryKeepDays + 1) * 86400, old, sizeof(old));
    if (dbOk(dbRequest("DELETE", String("/history/") + old, ""))) strlcpy(lastPruned, today, sizeof(lastPruned));
  }
}

// ---- Commands -------------------------------------------------------------

const char* runCommand(JsonObjectConst cmd, uint32_t epoch) {
  if (!epoch) return "TIME_UNKNOWN";
  const double tsMs = cmd["ts"] | 0.0;
  const double ageS = static_cast<double>(epoch) - tsMs / 1000.0;
  if (tsMs <= 0 || ageS > kCommandMaxAgeS || ageS < -static_cast<double>(kCommandMaxAgeS)) return "STALE_COMMAND";

  const char* type = cmd["type"] | "";
  const app::Source src = app::Source::Remote;
  ag::Deny d;
  if (!strcmp(type, "close")) d = app::cmdClose(src);
  else if (!strcmp(type, "open")) d = app::cmdOpen(src);
  else if (!strcmp(type, "ack")) d = app::cmdAck(src);
  else if (!strcmp(type, "mute")) d = app::cmdMute(src);
  else if (!strcmp(type, "setMode")) d = app::cmdMode(cmd["mode"] | "", src);
  else if (!strcmp(type, "setConfig")) {
    if (!cmd["config"].is<JsonObjectConst>()) return "BAD_REQUEST";
    return app::cmdSetConfig(cmd["config"].as<JsonObjectConst>(), src);
  } else return "UNKNOWN_COMMAND";
  return d == ag::Deny::None ? nullptr : ag::denyName(d);
}

void pollCommands() {
  String payload;
  const int code = dbRequest("GET", "/commands", "", &payload);
  if (!dbOk(code)) return;
  if (payload.isEmpty()) {  // oversized response: discard the queue rather than parse it
    dbRequest("DELETE", "/commands", "");
    return;
  }
  if (payload == "null") return;
  JsonDocument doc;
  if (deserializeJson(doc, payload) || !doc.is<JsonObject>()) return;

  for (JsonPairConst kv : doc.as<JsonObjectConst>()) {
    const String id = kv.key().c_str();
    // Remove the request first: if the link drops mid-way it must not run twice.
    if (!dbOk(dbRequest("DELETE", "/commands/" + id, ""))) continue;
    const char* error = kv.value().is<JsonObjectConst>()
                            ? runCommand(kv.value().as<JsonObjectConst>(), app::epochNow())
                            : "BAD_REQUEST";
    JsonDocument res;
    res["ok"] = error == nullptr;
    if (error) res["reason"] = error;
    res["type"] = kv.value()["type"] | "";
    res["at"][".sv"] = "timestamp";
    String body;
    serializeJson(res, body);
    dbRequest("PUT", "/results/" + id, body);
  }
}

// ---- Task -----------------------------------------------------------------

void task(void*) {
  const NetSettings n = app::net;  // settings only change through a restart
  if (!n.cloudEnabled || n.fbApiKey.isEmpty() || n.fbDbUrl.isEmpty() || n.fbEmail.isEmpty() ||
      n.fbPassword.isEmpty()) {
    state = State::Disabled;
    vTaskDelete(nullptr);
    return;
  }
  base = n.fbDbUrl + "/devices/" + n.deviceId;
  dbClient.setCACert(kGoogleRootCas);
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  uint32_t lastStatus = 0, lastCommands = 0, lastHistoryEpoch = 0;
  uint32_t sentSeq = 0, sentConfigRevision = 0;
  uint32_t backoffMs = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(backoffMs ? backoffMs : 250));
    if (WiFi.status() != WL_CONNECTED) {
      state = State::Offline;
      backoffMs = 2000;
      continue;
    }
    if (!app::epochNow()) {  // TLS needs the date; wait for NTP
      state = State::WaitingForTime;
      backoffMs = 1000;
      continue;
    }
    if (app::otaInProgress) {
      backoffMs = 1000;
      continue;
    }
    if (!ensureToken(n)) {
      state = State::AuthFailed;
      backoffMs = 30000;
      continue;
    }
    backoffMs = 0;
    const uint32_t now = millis();

    if (now - lastCommands >= kCommandPeriodMs) {
      lastCommands = now;
      pollCommands();
    }
    if (now - lastStatus >= kStatusPeriodMs) {
      lastStatus = now;
      if (pushStatus()) {
        state = State::Online;
      } else {
        state = State::Error;
        backoffMs = 10000;
        continue;
      }
      pushEvents(sentSeq);
      uint32_t revision;
      {
        app::Lock l;
        revision = app::cfgRevision;
      }
      if (revision != sentConfigRevision && pushConfig()) sentConfigRevision = revision;
    }
    const uint32_t epoch = app::epochNow();
    if (epoch - lastHistoryEpoch >= kHistoryPeriodS) {
      lastHistoryEpoch = epoch;
      pushHistory(epoch);
    }
  }
}
}  // namespace

State currentState() { return state; }

const char* stateName(State s) {
  switch (s) {
    case State::Disabled: return "DISABLED";
    case State::Offline: return "OFFLINE";
    case State::WaitingForTime: return "WAITING_FOR_TIME";
    case State::AuthFailed: return "AUTH_FAILED";
    case State::Error: return "ERROR";
    case State::Online: return "ONLINE";
  }
  return "UNKNOWN";
}

void begin() {
  // Large stack for TLS; priority below the control task and the web server.
  xTaskCreatePinnedToCore(task, "ag-cloud", 12288, nullptr, 1, nullptr, 0);
}

}  // namespace cloud
