// Wi-Fi, the local dashboard and the REST/SSE API of guide section 15.
// Command endpoints authenticate, validate, then submit a request to the
// SafetyManager through app::cmd*. They never write the valve GPIO.
#include "webapi.h"

#include <ESPAsyncWebServer.h>
#include <Update.h>

#include "power.h"
#include <WiFi.h>

#include "app.h"
#include "cloud.h"
#include "storage.h"
#include "version.h"

extern const char index_html_start[] asm("_binary_web_index_html_start");

namespace webapi {

namespace {
AsyncWebServer server(80);
AsyncEventSource live("/api/live");

// ---- Session: one token in RAM, replaced at each login.
String sessionToken;
uint32_t sessionSeenMs = 0;
constexpr uint32_t kSessionIdleMs = 30UL * 60UL * 1000UL;
uint8_t loginFailures = 0;
uint32_t loginLockedUntilMs = 0;

uint32_t restartAtMs = 0;
bool otaAccepted = false;
bool otaFailed = false;

constexpr size_t kMaxBody = 4096;

void sendJson(AsyncWebServerRequest* req, int code, const JsonDocument& doc) {
  power::noteActivity();  // someone is using the dashboard
  AsyncResponseStream* res = req->beginResponseStream("application/json");
  res->setCode(code);
  res->addHeader("Cache-Control", "no-store");
  serializeJson(doc, *res);
  req->send(res);
}

void sendResult(AsyncWebServerRequest* req, const char* error, int failCode = 409) {
  JsonDocument doc;
  doc["ok"] = error == nullptr;
  if (error) doc["reason"] = error;
  sendJson(req, error ? failCode : 200, doc);
}

void sendDeny(AsyncWebServerRequest* req, ag::Deny d) {
  sendResult(req, d == ag::Deny::None ? nullptr : ag::denyName(d));
}

// A browser on another site cannot set X-Auth-Token without a CORS preflight,
// which this server never answers; the Origin check is a second barrier.
bool sameOrigin(AsyncWebServerRequest* req) {
  if (!req->hasHeader("Origin")) return true;
  const String origin = req->header("Origin");
  return origin == "http://" + req->host();
}

bool authorised(AsyncWebServerRequest* req) {
  if (!sameOrigin(req)) return false;
  if (sessionToken.isEmpty() || !req->hasHeader("X-Auth-Token")) return false;
  if (millis() - sessionSeenMs > kSessionIdleMs) {
    sessionToken = "";
    return false;
  }
  if (!storage::constantTimeEquals(req->header("X-Auth-Token"), sessionToken)) return false;
  sessionSeenMs = millis();
  power::noteActivity();
  return true;
}

bool requireAuth(AsyncWebServerRequest* req) {
  if (authorised(req)) return true;
  sendResult(req, "UNAUTHORISED", 401);
  return false;
}

// ---- Body collection for JSON POSTs (bounded).
void collectBody(AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
  if (total > kMaxBody) return;
  if (index == 0) {
    req->_tempObject = malloc(total + 1);  // freed by the request destructor
    if (req->_tempObject) static_cast<char*>(req->_tempObject)[total] = '\0';
  }
  if (req->_tempObject) memcpy(static_cast<char*>(req->_tempObject) + index, data, len);
}

bool parseBody(AsyncWebServerRequest* req, JsonDocument& doc) {
  if (!req->_tempObject) return false;
  return !deserializeJson(doc, static_cast<const char*>(req->_tempObject)) && doc.is<JsonObject>();
}

using JsonHandler = void (*)(AsyncWebServerRequest*, JsonObjectConst);

void onJsonPost(const char* uri, JsonHandler handler, bool needsAuth = true) {
  server.on(
      uri, HTTP_POST,
      [handler, needsAuth](AsyncWebServerRequest* req) {
        if (needsAuth && !requireAuth(req)) return;
        JsonDocument doc;
        if (!parseBody(req, doc)) {
          sendResult(req, "BAD_JSON", 400);
          return;
        }
        handler(req, doc.as<JsonObjectConst>());
      },
      nullptr, collectBody);
}

void onCommand(const char* uri, ag::Deny (*fn)(app::Source)) {
  server.on(uri, HTTP_POST, [fn](AsyncWebServerRequest* req) {
    if (!requireAuth(req)) return;
    sendDeny(req, fn(app::Source::Local));
  });
}

// --------------------------------------------------------------- handlers

void handleSetup(AsyncWebServerRequest* req, JsonObjectConst body) {
  // First-time only: choose the administrator password.
  if (!sameOrigin(req)) return sendResult(req, "UNAUTHORISED", 401);
  if (!app::net.adminHash.isEmpty()) return sendResult(req, "ALREADY_SET_UP", 409);
  const String password = body["password"] | "";
  if (password.length() < 8) return sendResult(req, "PASSWORD_TOO_SHORT", 400);
  app::net.adminSalt = storage::randomHex(8);
  app::net.adminHash = storage::hashPassword(app::net.adminSalt, password);
  storage::saveNet(app::net);
  sendResult(req, nullptr);
}

void handleLogin(AsyncWebServerRequest* req, JsonObjectConst body) {
  if (!sameOrigin(req)) return sendResult(req, "UNAUTHORISED", 401);
  if (app::net.adminHash.isEmpty()) return sendResult(req, "SETUP_REQUIRED", 409);
  if (static_cast<int32_t>(millis() - loginLockedUntilMs) < 0) return sendResult(req, "TRY_LATER", 429);
  const String password = body["password"] | "";
  const String hash = storage::hashPassword(app::net.adminSalt, password);
  if (!storage::constantTimeEquals(hash, app::net.adminHash)) {
    if (++loginFailures >= 5) {
      loginFailures = 0;
      loginLockedUntilMs = millis() + 60000;
    }
    return sendResult(req, "WRONG_PASSWORD", 401);
  }
  loginFailures = 0;
  sessionToken = storage::randomHex(16);
  sessionSeenMs = millis();
  JsonDocument doc;
  doc["ok"] = true;
  doc["token"] = sessionToken;
  sendJson(req, 200, doc);
}

void handleMode(AsyncWebServerRequest* req, JsonObjectConst body) {
  sendDeny(req, app::cmdMode(body["mode"] | "", app::Source::Local));
}

void handleConfig(AsyncWebServerRequest* req, JsonObjectConst body) {
  sendResult(req, app::cmdSetConfig(body, app::Source::Local), 400);
}

void handleNetwork(AsyncWebServerRequest* req, JsonObjectConst body) {
  // Work on a copy: the running settings only change through the restart.
  NetSettings n = app::net;
  // Secrets are write-only: an absent or empty value keeps the stored one.
  if (body["wifiSsid"].is<const char*>()) n.wifiSsid = body["wifiSsid"].as<const char*>();
  if (strlen(body["wifiPass"] | "")) n.wifiPass = body["wifiPass"].as<const char*>();
  if (body["cloudEnabled"].is<bool>()) n.cloudEnabled = body["cloudEnabled"];
  if (body["remoteControl"].is<bool>()) n.remoteControl = body["remoteControl"];
  if (body["sleepEnabled"].is<bool>()) n.sleepEnabled = body["sleepEnabled"];
  if (!body["sleepMinutes"].isNull()) {
    const int minutes = body["sleepMinutes"].is<const char*>() ? atoi(body["sleepMinutes"].as<const char*>())
                                                               : body["sleepMinutes"].as<int>();
    if (minutes < 1 || minutes > 60) return sendResult(req, "SLEEP_MINUTES_1_TO_60", 400);
    n.sleepMinutes = static_cast<uint8_t>(minutes);
  }
  if (body["fbDbUrl"].is<const char*>()) n.fbDbUrl = body["fbDbUrl"].as<const char*>();
  if (body["fbEmail"].is<const char*>()) n.fbEmail = body["fbEmail"].as<const char*>();
  if (strlen(body["fbApiKey"] | "")) n.fbApiKey = body["fbApiKey"].as<const char*>();
  if (strlen(body["fbPassword"] | "")) n.fbPassword = body["fbPassword"].as<const char*>();
  n.fbDbUrl.trim();
  while (n.fbDbUrl.endsWith("/")) n.fbDbUrl.remove(n.fbDbUrl.length() - 1);
  if (n.cloudEnabled && !n.fbDbUrl.startsWith("https://")) return sendResult(req, "DB_URL_MUST_BE_HTTPS", 400);
  if (strlen(body["newAdminPassword"] | "")) {
    const String pw = body["newAdminPassword"].as<const char*>();
    if (pw.length() < 8) return sendResult(req, "PASSWORD_TOO_SHORT", 400);
    n.adminSalt = storage::randomHex(8);
    n.adminHash = storage::hashPassword(n.adminSalt, pw);
  }
  storage::saveNet(n);
  JsonDocument doc;
  doc["ok"] = true;
  doc["restarting"] = true;
  sendJson(req, 200, doc);
  restartAtMs = millis() + 1500;  // reboot into the new settings (boots disarmed)
}

void handleOtaChunk(AsyncWebServerRequest* req, const String&, size_t index, uint8_t* data, size_t len, bool final) {
  if (index == 0) {
    otaAccepted = false;
    otaFailed = false;
    if (!authorised(req)) return;
    {
      // Disarm and close before accepting any image data.
      app::Lock l;
      app::otaInProgress = true;
      app::safety.disarm(millis());
      app::safety.setLockout(true, millis());
      app::logEvent(ag::Event::OtaStarted, 0);
    }
    otaAccepted = Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH);
    otaFailed = !otaAccepted;
  }
  if (!otaAccepted || otaFailed) return;
  if (Update.write(data, len) != len) otaFailed = true;
  if (final && !otaFailed && !Update.end(true)) otaFailed = true;
}

void handleOtaDone(AsyncWebServerRequest* req) {
  if (!otaAccepted && !otaFailed) return sendResult(req, "UNAUTHORISED", 401);
  if (otaFailed) {
    Update.abort();
    {
      // Stay disarmed and closed; the running image is untouched.
      app::Lock l;
      app::otaInProgress = false;
      app::safety.setLockout(false, millis());
    }
    return sendResult(req, "UPDATE_FAILED", 500);
  }
  sendResult(req, nullptr);
  restartAtMs = millis() + 1500;
}

void routes() {
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    AsyncWebServerResponse* res = req->beginResponse(200, "text/html; charset=utf-8", index_html_start);
    res->addHeader("Cache-Control", "no-cache");
    res->addHeader("X-Frame-Options", "DENY");
    res->addHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline'");
    req->send(res);
  });

  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    JsonDocument doc;
    app::fillStatus(doc.to<JsonObject>());
    doc["setupRequired"] = app::net.adminHash.isEmpty();
    doc["setupAp"] = static_cast<bool>(app::setupApActive);
    doc["cloud"] = cloud::stateName(cloud::currentState());
    sendJson(req, 200, doc);
  });

  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest* req) {
    JsonDocument doc;
    app::fillConfig(doc.to<JsonObject>());
    sendJson(req, 200, doc);
  });

  server.on("/api/diag", HTTP_GET, [](AsyncWebServerRequest* req) {
    JsonDocument doc;
    app::fillDiag(doc.to<JsonObject>());
    sendJson(req, 200, doc);
  });

  server.on("/api/events", HTTP_GET, [](AsyncWebServerRequest* req) {
    static LogEntry entries[app::kLogSize];
    const size_t n = app::copyLog(entries, app::kLogSize, 0);
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (size_t i = n; i-- > 0;) app::fillEvent(arr.add<JsonObject>(), entries[i]);  // newest first
    sendJson(req, 200, doc);
  });

  // Never returns passwords or the API key.
  server.on("/api/network", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!requireAuth(req)) return;
    const NetSettings& n = app::net;
    JsonDocument doc;
    doc["deviceId"] = n.deviceId;
    doc["wifiSsid"] = n.wifiSsid;
    doc["hasWifiPass"] = !n.wifiPass.isEmpty();
    doc["cloudEnabled"] = n.cloudEnabled;
    doc["remoteControl"] = n.remoteControl;
    doc["sleepEnabled"] = n.sleepEnabled;
    doc["sleepMinutes"] = n.sleepMinutes;
    doc["fbDbUrl"] = n.fbDbUrl;
    doc["fbEmail"] = n.fbEmail;
    doc["hasFbApiKey"] = !n.fbApiKey.isEmpty();
    doc["hasFbPassword"] = !n.fbPassword.isEmpty();
    sendJson(req, 200, doc);
  });

  onJsonPost("/api/setup", handleSetup, false);
  onJsonPost("/api/login", handleLogin, false);
  onJsonPost("/api/mode", handleMode);
  onJsonPost("/api/config", handleConfig);
  onJsonPost("/api/network", handleNetwork);

  onCommand("/api/valve/open", app::cmdOpen);
  onCommand("/api/valve/close", app::cmdClose);
  onCommand("/api/fault/ack", app::cmdAck);
  onCommand("/api/buzzer/mute", app::cmdMute);

  server.on("/api/calibrate/full", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (requireAuth(req)) sendResult(req, app::cmdCalibrate(true));
  });
  server.on("/api/calibrate/empty", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (requireAuth(req)) sendResult(req, app::cmdCalibrate(false));
  });

  server.on("/api/ota", HTTP_POST, handleOtaDone, handleOtaChunk);

  server.addHandler(&live);
  server.onNotFound([](AsyncWebServerRequest* req) { sendResult(req, "NOT_FOUND", 404); });
}
}  // namespace

void begin(bool forceSetupAp) {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(app::net.deviceId.c_str());

  const bool haveWifi = !app::net.wifiSsid.isEmpty();
  if (!haveWifi || forceSetupAp) {
    // Protected setup access point: commissioning and network recovery only.
    WiFi.mode(haveWifi ? WIFI_AP_STA : WIFI_AP);
    String ssid = "AquaGuard-" + app::net.deviceId.substring(3);
    WiFi.softAP(ssid.c_str(), app::net.apPassword.c_str());
    app::setupApActive = true;
    Serial.printf("[net] setup AP %s  password %s  http://192.168.4.1\n", ssid.c_str(),
                  app::net.apPassword.c_str());
  } else {
    WiFi.mode(WIFI_STA);
  }
  if (haveWifi) WiFi.begin(app::net.wifiSsid.c_str(), app::net.wifiPass.c_str());

  routes();
  server.begin();
}

void loop() {
  static uint32_t lastPush = 0;
  static uint32_t lastReconnect = 0;
  const uint32_t now = millis();

  if (restartAtMs && static_cast<int32_t>(now - restartAtMs) >= 0) {
    {
      app::Lock l;
      app::safety.disarm(now);
    }
    delay(50);  // let the control task drive the valve request LOW
    ESP.restart();
  }

  // Wi-Fi loss never affects control; just keep retrying in the background.
  if (!app::net.wifiSsid.isEmpty() && WiFi.status() != WL_CONNECTED && now - lastReconnect > 30000) {
    lastReconnect = now;
    WiFi.reconnect();
  }

  if (now - lastPush >= 1000 && live.count() > 0) {
    lastPush = now;
    power::noteActivity();  // the dashboard is open in a browser
    JsonDocument doc;
    app::fillStatus(doc.to<JsonObject>());
    String json;
    serializeJson(doc, json);
    live.send(json.c_str(), "status", now);
  }
}

}  // namespace webapi
