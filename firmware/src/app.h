// Shared application state. Everything here is guarded by app::lock.
// Network, UI and cloud code never touch the valve pin: they submit requests
// through the cmd* functions, which forward to ag::SafetyManager.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "ag_config.h"
#include "ag_safety.h"
#include "ag_sensor.h"

struct NetSettings {
  String wifiSsid, wifiPass;
  String apPassword;             // random, generated at first boot
  String adminSalt, adminHash;   // SHA-256(salt + password), hex
  String deviceId;               // "ag-" + last three MAC bytes
  bool cloudEnabled = false;
  bool remoteControl = false;    // only changeable from the local dashboard
  String fbApiKey, fbDbUrl, fbEmail, fbPassword;
};

struct LogEntry {
  uint32_t seq;
  uint32_t uptimeS;
  uint32_t epoch;  // 0 while clock time is unknown
  ag::Event event;
  int32_t arg;
};

namespace app {

enum class Source : uint8_t { Local, Remote };

extern SemaphoreHandle_t lock;
struct Lock {
  Lock() { xSemaphoreTake(lock, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(lock); }
  Lock(const Lock&) = delete;
  Lock& operator=(const Lock&) = delete;
};

// ---- State (hold app::lock).
extern ag::Config cfg;
extern bool cfgValid;
extern const char* cfgError;      // why the stored config was rejected, or nullptr
extern uint32_t cfgRevision;      // bumped on every accepted change
extern ag::SafetyManager safety;
extern ag::LevelPipeline pipeline;
extern ag::JsnParser parser;
extern ag::SafetyInputs inputs;   // last values fed to the safety manager
extern NetSettings net;
extern volatile bool setupApActive;
extern volatile bool otaInProgress;

void begin();                     // create the lock, load storage, start safety
uint32_t epochNow();              // 0 until NTP has set the clock

// ---- Event log (RAM ring). logEvent requires the lock to be held.
constexpr size_t kLogSize = 64;
void logEvent(ag::Event e, int32_t arg);
size_t copyLog(LogEntry* out, size_t max, uint32_t afterSeq);  // takes the lock

// ---- Requests. These take the lock themselves.
ag::Deny cmdMode(const char* mode, Source src);
ag::Deny cmdOpen(Source src);
ag::Deny cmdClose(Source src);
ag::Deny cmdAck(Source src);
ag::Deny cmdMute(Source src);
// Apply a partial settings object. Returns nullptr or a reason string.
const char* cmdSetConfig(JsonObjectConst patch, Source src);
// Capture the calibration median into full/empty distance.
const char* cmdCalibrate(bool full);

// ---- JSON views. These take the lock themselves.
void fillStatus(JsonObject out);
void fillConfig(JsonObject out);
void fillDiag(JsonObject out);
void fillEvent(JsonObject out, const LogEntry& e);

}  // namespace app
