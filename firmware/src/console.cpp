// USB serial console. One command per line:
//
//   status            Wi-Fi, address, Firebase link, armed state
//   provision {json}  save network settings and restart. Keys (all optional):
//                     wifiSsid, wifiPass, adminPassword, fbDbUrl, fbApiKey,
//                     fbEmail, fbPassword, cloudEnabled, remoteControl
//   bench-arm         bench-test build only: mark commissioned and acknowledge
//
// Passwords are never printed back. Anyone who can reach the USB port can
// already replace the firmware, so this adds no new access; it does not open
// the valve or change calibration.
#include "console.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>

#include "app.h"
#include "cloud.h"
#include "storage.h"

namespace console {

namespace {
constexpr size_t kMaxLine = 1024;
char line[kMaxLine + 1];
size_t length = 0;
bool overflow = false;

void printStatus() {
  const bool up = WiFi.status() == WL_CONNECTED;
  bool armed;
  uint16_t faults;
  {
    app::Lock l;
    armed = app::safety.armed();
    faults = app::safety.faults();
  }
  Serial.printf("[status] device %s  wifi %s  %s  cloud %s  armed %d  faults 0x%02x\n", app::net.deviceId.c_str(),
                app::setupApActive ? "SETUP_AP" : up ? "CONNECTED" : "NOT_CONNECTED",
                up ? ("http://" + WiFi.localIP().toString()).c_str() : "-",
                cloud::stateName(cloud::currentState()), armed ? 1 : 0, faults);
}

void provision(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json) || !doc.is<JsonObject>()) return (void)Serial.println("ERR BAD_JSON");
  NetSettings n = app::net;  // work on a copy; applied by the restart
  if (doc["wifiSsid"].is<const char*>()) n.wifiSsid = doc["wifiSsid"].as<const char*>();
  if (doc["wifiPass"].is<const char*>()) n.wifiPass = doc["wifiPass"].as<const char*>();
  if (doc["fbDbUrl"].is<const char*>()) n.fbDbUrl = doc["fbDbUrl"].as<const char*>();
  if (doc["fbApiKey"].is<const char*>()) n.fbApiKey = doc["fbApiKey"].as<const char*>();
  if (doc["fbEmail"].is<const char*>()) n.fbEmail = doc["fbEmail"].as<const char*>();
  if (doc["fbPassword"].is<const char*>()) n.fbPassword = doc["fbPassword"].as<const char*>();
  if (doc["cloudEnabled"].is<bool>()) n.cloudEnabled = doc["cloudEnabled"];
  if (doc["remoteControl"].is<bool>()) n.remoteControl = doc["remoteControl"];
  n.fbDbUrl.trim();
  while (n.fbDbUrl.endsWith("/")) n.fbDbUrl.remove(n.fbDbUrl.length() - 1);
  if (n.wifiSsid.length() > 32) return (void)Serial.println("ERR WIFI_NAME_TOO_LONG");
  if (n.cloudEnabled && !n.fbDbUrl.startsWith("https://")) return (void)Serial.println("ERR DB_URL_MUST_BE_HTTPS");
  if (doc["adminPassword"].is<const char*>()) {
    const String pw = doc["adminPassword"].as<const char*>();
    if (pw.length() < 8) return (void)Serial.println("ERR PASSWORD_TOO_SHORT");
    n.adminSalt = storage::randomHex(8);
    n.adminHash = storage::hashPassword(n.adminSalt, pw);
  }
  storage::saveNet(n);
  Serial.println("OK saved, restarting");
  Serial.flush();
  {
    app::Lock l;
    app::safety.disarm(millis());
  }
  delay(100);  // let the control task drive the valve request LOW
  ESP.restart();
}

void handle(char* text) {
  while (*text == ' ') text++;
  if (!strcmp(text, "status")) return printStatus();
  if (!strncmp(text, "provision ", 10)) return provision(text + 10);
#ifdef AQUAGUARD_SIMULATION
  if (!strcmp(text, "bench-arm")) {
    JsonDocument patch;
    patch["commissioned"] = true;
    const char* error = app::cmdSetConfig(patch.as<JsonObjectConst>(), app::Source::Local);
    if (error) return (void)Serial.printf("ERR %s\n", error);
    delay(3000);  // a settings change restarts level validation
    Serial.printf("bench-arm: %s\n", ag::denyName(app::cmdAck(app::Source::Local)));
    return;
  }
#endif
  if (*text) Serial.println("ERR UNKNOWN_COMMAND (status | provision {json})");
}
}  // namespace

void loop() {
  // Report Wi-Fi changes so the address can be read over USB.
  static bool wasUp = false;
  const bool up = WiFi.status() == WL_CONNECTED;
  if (up != wasUp) {
    wasUp = up;
    if (up) Serial.printf("[net] Wi-Fi connected  http://%s\n", WiFi.localIP().toString().c_str());
    else Serial.println("[net] Wi-Fi disconnected");
  }
  static cloud::State lastCloud = cloud::State::Disabled;
  const cloud::State c = cloud::currentState();
  if (c != lastCloud) {
    lastCloud = c;
    Serial.printf("[cloud] %s\n", cloud::stateName(c));
  }

  int budget = 256;
  while (budget-- > 0 && Serial.available() > 0) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch == '\n') {
      line[length] = '\0';
      if (overflow) Serial.println("ERR LINE_TOO_LONG");
      else handle(line);
      memset(line, 0, sizeof(line));  // do not keep passwords in the buffer
      length = 0;
      overflow = false;
    } else if (length < kMaxLine) {
      line[length++] = ch;
    } else {
      overflow = true;
    }
  }
}

}  // namespace console
