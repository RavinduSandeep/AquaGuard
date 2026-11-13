#include "storage.h"

#include <Preferences.h>
#include <esp_random.h>
#include <mbedtls/md.h>

#include <cmath>
#include <limits>
#include <type_traits>

namespace storage {

namespace {
constexpr char kNsConfig[] = "ag-config";
constexpr char kNsNet[] = "ag-net";
constexpr char kNsState[] = "ag-state";

uint32_t crc32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

template <typename T>
void readNumber(JsonObjectConst in, const char* key, T& out, const char** err) {
  JsonVariantConst v = in[key];
  if (v.isNull()) return;
  if (!v.is<double>()) {
    *err = "NOT_A_NUMBER";
    return;
  }
  const double d = v.as<double>();
  if (std::is_integral<T>::value &&
      (d != floor(d) || d < std::numeric_limits<T>::min() || d > std::numeric_limits<T>::max())) {
    *err = "NUMBER_OUT_OF_RANGE";
    return;
  }
  out = static_cast<T>(d);
}

void readBool(JsonObjectConst in, const char* key, bool& out, const char** err) {
  JsonVariantConst v = in[key];
  if (v.isNull()) return;
  if (!v.is<bool>()) {
    *err = "NOT_A_BOOLEAN";
    return;
  }
  out = v.as<bool>();
}
}  // namespace

void configToJson(const ag::Config& c, JsonObject o) {
  o["schema"] = ag::kConfigSchema;
  o["tankName"] = c.tankName;
  o["fullDistanceCm"] = c.fullDistanceCm;
  o["emptyDistanceCm"] = c.emptyDistanceCm;
  o["usableCapacityLitres"] = c.usableCapacityLitres;
  o["commissioned"] = c.commissioned;
  o["startFillPercent"] = c.startFillPercent;
  o["stopFillPercent"] = c.stopFillPercent;
  o["highHighPercent"] = c.highHighPercent;
  o["validDistanceMinCm"] = c.validDistanceMinCm;
  o["validDistanceMaxCm"] = c.validDistanceMaxCm;
  o["medianSamples"] = c.medianSamples;
  o["maxChangePercentPerSecond"] = c.maxChangePercentPerSecond;
  o["validationIntervalMs"] = c.validationIntervalMs;
  o["staleTimeoutMs"] = c.staleTimeoutMs;
  o["warningCount"] = c.warningCount;
  o["faultCount"] = c.faultCount;
  o["maximumFillMinutes"] = c.maximumFillMinutes;
  o["progressWindowMinutes"] = c.progressWindowMinutes;
  o["minRisePercent"] = c.minRisePercent;
  o["noProgressStopMinutes"] = c.noProgressStopMinutes;
  o["autoRetry"] = c.autoRetry;
  o["retryMinutes"] = c.retryMinutes;
  o["floatClearDelaySeconds"] = c.floatClearDelaySeconds;
  o["maintenanceMinutes"] = c.maintenanceMinutes;
  o["manualOpenMinutes"] = c.manualOpenMinutes;
  o["ledBrightnessPercent"] = c.ledBrightnessPercent;
  o["buzzerEnabled"] = c.buzzerEnabled;
}

const char* configFromJson(JsonObjectConst in, ag::Config& c, bool remote) {
  if (remote) {
    // Calibration and commissioning are on-site activities.
    static const char* const localOnly[] = {"fullDistanceCm", "emptyDistanceCm", "validDistanceMinCm",
                                            "validDistanceMaxCm", "commissioned"};
    for (const char* key : localOnly) {
      if (!in[key].isNull()) return "LOCAL_ONLY_SETTING";
    }
  }
  const char* err = nullptr;

  JsonVariantConst name = in["tankName"];
  if (!name.isNull()) {
    if (!name.is<const char*>()) return "TANK_NAME_NOT_TEXT";
    const char* s = name.as<const char*>();
    if (strlen(s) >= sizeof(c.tankName)) return "TANK_NAME_TOO_LONG";
    strlcpy(c.tankName, s, sizeof(c.tankName));
  }

  readNumber(in, "fullDistanceCm", c.fullDistanceCm, &err);
  readNumber(in, "emptyDistanceCm", c.emptyDistanceCm, &err);
  readNumber(in, "usableCapacityLitres", c.usableCapacityLitres, &err);
  readBool(in, "commissioned", c.commissioned, &err);
  readNumber(in, "startFillPercent", c.startFillPercent, &err);
  readNumber(in, "stopFillPercent", c.stopFillPercent, &err);
  readNumber(in, "highHighPercent", c.highHighPercent, &err);
  readNumber(in, "validDistanceMinCm", c.validDistanceMinCm, &err);
  readNumber(in, "validDistanceMaxCm", c.validDistanceMaxCm, &err);
  readNumber(in, "medianSamples", c.medianSamples, &err);
  readNumber(in, "maxChangePercentPerSecond", c.maxChangePercentPerSecond, &err);
  readNumber(in, "validationIntervalMs", c.validationIntervalMs, &err);
  readNumber(in, "staleTimeoutMs", c.staleTimeoutMs, &err);
  readNumber(in, "warningCount", c.warningCount, &err);
  readNumber(in, "faultCount", c.faultCount, &err);
  readNumber(in, "maximumFillMinutes", c.maximumFillMinutes, &err);
  readNumber(in, "progressWindowMinutes", c.progressWindowMinutes, &err);
  readNumber(in, "minRisePercent", c.minRisePercent, &err);
  readNumber(in, "noProgressStopMinutes", c.noProgressStopMinutes, &err);
  readBool(in, "autoRetry", c.autoRetry, &err);
  readNumber(in, "retryMinutes", c.retryMinutes, &err);
  readNumber(in, "floatClearDelaySeconds", c.floatClearDelaySeconds, &err);
  readNumber(in, "maintenanceMinutes", c.maintenanceMinutes, &err);
  readNumber(in, "manualOpenMinutes", c.manualOpenMinutes, &err);
  readNumber(in, "ledBrightnessPercent", c.ledBrightnessPercent, &err);
  readBool(in, "buzzerEnabled", c.buzzerEnabled, &err);
  if (err) return err;
  return ag::validateConfig(c);
}

bool loadConfig(ag::Config& c, const char** error) {
  *error = nullptr;
  c = ag::Config();
  Preferences p;
  if (!p.begin(kNsConfig, true)) return true;  // namespace absent: first boot
  const String json = p.getString("json", "");
  const uint32_t storedCrc = p.getUInt("crc", 0);
  p.end();
  if (json.isEmpty()) return true;

  if (crc32(reinterpret_cast<const uint8_t*>(json.c_str()), json.length()) != storedCrc) {
    *error = "CONFIG_CRC_MISMATCH";
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json)) {
    *error = "CONFIG_NOT_JSON";
    return false;
  }
  if ((doc["schema"] | 0) != ag::kConfigSchema) {
    *error = "CONFIG_SCHEMA_UNKNOWN";
    return false;
  }
  ag::Config loaded;
  const char* why = configFromJson(doc.as<JsonObjectConst>(), loaded, false);
  if (why) {
    *error = why;
    return false;
  }
  c = loaded;
  return true;
}

bool saveConfig(const ag::Config& c) {
  JsonDocument doc;
  configToJson(c, doc.to<JsonObject>());
  String json;
  serializeJson(doc, json);
  Preferences p;
  if (!p.begin(kNsConfig, false)) return false;
  const bool ok = p.putString("json", json) == json.length();
  p.putUInt("crc", crc32(reinterpret_cast<const uint8_t*>(json.c_str()), json.length()));
  p.end();
  return ok;
}

void loadNet(NetSettings& n) {
  Preferences p;
  p.begin(kNsNet, false);
  n.wifiSsid = p.getString("ssid", "");
  n.wifiPass = p.getString("pass", "");
  n.apPassword = p.getString("appass", "");
  n.adminSalt = p.getString("salt", "");
  n.adminHash = p.getString("hash", "");
  n.cloudEnabled = p.getBool("cloud", false);
  n.remoteControl = p.getBool("remote", false);
  n.fbApiKey = p.getString("fbkey", "");
  n.fbDbUrl = p.getString("fburl", "");
  n.fbEmail = p.getString("fbmail", "");
  n.fbPassword = p.getString("fbpass", "");
  n.sleepEnabled = p.getBool("sleep", false);
  n.sleepMinutes = constrain(p.getUChar("sleepmin", 10), 1, 60);
  if (n.apPassword.length() < 8) {
    n.apPassword = randomHex(5);  // 10 hex characters, unique per unit
    p.putString("appass", n.apPassword);
  }
  p.end();

  const uint64_t mac = ESP.getEfuseMac();  // bytes are stored low-first
  char id[16];
  snprintf(id, sizeof(id), "ag-%02x%02x%02x", static_cast<uint8_t>(mac >> 24),
           static_cast<uint8_t>(mac >> 32), static_cast<uint8_t>(mac >> 40));
  n.deviceId = id;
}

void saveNet(const NetSettings& n) {
  Preferences p;
  p.begin(kNsNet, false);
  p.putString("ssid", n.wifiSsid);
  p.putString("pass", n.wifiPass);
  p.putString("salt", n.adminSalt);
  p.putString("hash", n.adminHash);
  p.putBool("cloud", n.cloudEnabled);
  p.putBool("remote", n.remoteControl);
  p.putString("fbkey", n.fbApiKey);
  p.putString("fburl", n.fbDbUrl);
  p.putString("fbmail", n.fbEmail);
  p.putString("fbpass", n.fbPassword);
  p.putBool("sleep", n.sleepEnabled);
  p.putUChar("sleepmin", n.sleepMinutes);
  p.end();
}

uint16_t loadFaults() {
  Preferences p;
  if (!p.begin(kNsState, true)) return 0;
  const uint16_t f = p.getUShort("faults", 0);
  p.end();
  return f;
}

void saveFaults(uint16_t faults) {
  Preferences p;
  if (!p.begin(kNsState, false)) return;
  p.putUShort("faults", faults);
  p.end();
}

String randomHex(size_t bytes) {
  String s;
  s.reserve(bytes * 2);
  for (size_t i = 0; i < bytes; i++) {
    char b[3];
    snprintf(b, sizeof(b), "%02x", static_cast<uint8_t>(esp_random()));
    s += b;
  }
  return s;
}

String hashPassword(const String& salt, const String& password) {
  const String input = salt + password;
  uint8_t digest[32];
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
             reinterpret_cast<const unsigned char*>(input.c_str()), input.length(), digest);
  String hex;
  hex.reserve(64);
  for (uint8_t b : digest) {
    char t[3];
    snprintf(t, sizeof(t), "%02x", b);
    hex += t;
  }
  return hex;
}

bool constantTimeEquals(const String& a, const String& b) {
  if (a.length() != b.length()) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < a.length(); i++) diff |= static_cast<uint8_t>(a[i] ^ b[i]);
  return diff == 0;
}

}  // namespace storage
