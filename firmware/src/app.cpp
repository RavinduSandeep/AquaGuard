#include "app.h"

#include <WiFi.h>
#include <time.h>

#include "storage.h"
#include "version.h"

namespace app {

SemaphoreHandle_t lock = nullptr;
ag::Config cfg;
bool cfgValid = false;
const char* cfgError = nullptr;
uint32_t cfgRevision = 1;
ag::SafetyManager safety;
ag::LevelPipeline pipeline;
ag::JsnParser parser;
ag::SafetyInputs inputs;
NetSettings net;
volatile bool setupApActive = false;
volatile bool otaInProgress = false;
volatile uint32_t sleepUntilEpoch = 0;

namespace {
LogEntry logRing[kLogSize];
uint32_t logSeq = 0;

void safetySink(void*, ag::Event e, int32_t arg) { logEvent(e, arg); }

bool remoteAllowed(Source src) { return src == Source::Local || net.remoteControl; }
}  // namespace

uint32_t epochNow() {
  const time_t t = time(nullptr);
  return t > 1700000000 ? static_cast<uint32_t>(t) : 0;
}

void begin() {
  lock = xSemaphoreCreateMutex();
  storage::loadNet(net);
  cfgValid = storage::loadConfig(cfg, &cfgError);
  pipeline.configure(cfg);
  safety.setEventSink(safetySink, nullptr);
  safety.begin(cfg, cfgValid, storage::loadFaults(), millis());
}

void logEvent(ag::Event e, int32_t arg) {
  LogEntry& entry = logRing[logSeq % kLogSize];
  entry.seq = ++logSeq;
  entry.uptimeS = millis() / 1000;
  entry.epoch = epochNow();
  entry.event = e;
  entry.arg = arg;
}

size_t copyLog(LogEntry* out, size_t max, uint32_t afterSeq) {
  Lock l;
  const uint32_t oldest = logSeq > kLogSize ? logSeq - kLogSize + 1 : 1;
  uint32_t seq = afterSeq + 1 > oldest ? afterSeq + 1 : oldest;
  size_t n = 0;
  for (; seq <= logSeq && n < max; seq++) out[n++] = logRing[(seq - 1) % kLogSize];
  return n;
}

// ------------------------------------------------------------------ requests

ag::Deny cmdMode(const char* mode, Source src) {
  Lock l;
  if (!remoteAllowed(src)) return ag::Deny::RemoteDisabled;
  ag::Mode m;
  if (!mode) return ag::Deny::BadRequest;
  if (!strcmp(mode, "AUTO")) m = ag::Mode::Auto;
  else if (!strcmp(mode, "MANUAL")) m = ag::Mode::Manual;
  else if (!strcmp(mode, "MAINTENANCE")) m = ag::Mode::Maintenance;
  else return ag::Deny::BadRequest;
  return safety.requestMode(m, millis());
}

ag::Deny cmdOpen(Source src) {
  Lock l;
  if (!remoteAllowed(src)) return ag::Deny::RemoteDisabled;
  return safety.requestOpen(millis());
}

ag::Deny cmdClose(Source) {
  Lock l;  // closing is always allowed, from anywhere
  return safety.requestClose(millis());
}

ag::Deny cmdAck(Source src) {
  Lock l;
  if (!remoteAllowed(src)) return ag::Deny::RemoteDisabled;
  return safety.acknowledge(millis(), src == Source::Local);
}

ag::Deny cmdMute(Source) {
  Lock l;
  safety.mute();
  return ag::Deny::None;
}

const char* cmdSetConfig(JsonObjectConst patch, Source src) {
  Lock l;
  if (!remoteAllowed(src)) return ag::denyName(ag::Deny::RemoteDisabled);
  if (otaInProgress) return ag::denyName(ag::Deny::Lockout);
  ag::Config next = cfgValid ? cfg : ag::Config();
  const char* why = storage::configFromJson(patch, next, src == Source::Remote);
  if (why) {
    logEvent(ag::Event::SettingsRejected, 0);
    return why;
  }
  // Valve closed while settings change; measurement history is discarded so
  // nothing computed with the old calibration is trusted.
  safety.applyConfig(next, millis());
  pipeline.configure(next);
  cfg = next;
  cfgValid = true;
  cfgError = nullptr;
  cfgRevision++;
  if (!storage::saveConfig(cfg)) return "STORAGE_WRITE_FAILED";
  return nullptr;
}

const char* cmdCalibrate(bool full) {
  Lock l;
  if (otaInProgress) return ag::denyName(ag::Deny::Lockout);
  float cm = 0.0f;
  if (!pipeline.calibrationMedianCm(&cm)) return "READINGS_NOT_SETTLED";
  ag::Config next = cfgValid ? cfg : ag::Config();
  if (full) next.fullDistanceCm = cm; else next.emptyDistanceCm = cm;
  next.commissioned = false;  // must be confirmed again after any calibration
  const char* why = ag::validateConfig(next);
  if (why) return why;
  safety.applyConfig(next, millis());
  pipeline.configure(next);
  cfg = next;
  cfgValid = true;
  cfgError = nullptr;
  cfgRevision++;
  logEvent(ag::Event::Calibrated, static_cast<int32_t>(cm * 10.0f) | (full ? 0x10000 : 0));
  if (!storage::saveConfig(cfg)) return "STORAGE_WRITE_FAILED";
  return nullptr;
}

// --------------------------------------------------------------------- views

void fillStatus(JsonObject o) {
  const bool wifiUp = WiFi.status() == WL_CONNECTED;
  const int rssi = wifiUp ? WiFi.RSSI() : 0;
  const String ip = wifiUp ? WiFi.localIP().toString() : String();

  Lock l;
  const uint32_t now = millis();
  o["schema"] = AQUAGUARD_DATA_SCHEMA;
  o["fw"] = AQUAGUARD_FW_VERSION;
  o["deviceId"] = net.deviceId;
  o["tankName"] = cfg.tankName;
  o["uptimeS"] = now / 1000;
  o["ts"] = epochNow();
#ifdef AQUAGUARD_SIMULATION
  o["simulated"] = true;  // bench-test build: pretend sensor and inputs, valve output disabled
#endif

  const bool valid = !pipeline.isStale(now);
  JsonObject level = o["level"].to<JsonObject>();
  level["valid"] = valid;
  if (pipeline.hasTrusted()) {
    // The last trusted value stays visible but is flagged invalid when stale.
    const float pct = pipeline.trustedPercent();
    level["percent"] = roundf(pct * 10.0f) / 10.0f;
    level["litres"] = roundf(ag::estimatedLitres(pct, cfg.usableCapacityLitres));
    level["distanceCm"] = roundf(pipeline.trustedDistanceCm() * 10.0f) / 10.0f;
    level["ageMs"] = pipeline.ageMs(now);
    level["highHigh"] = valid && pct >= cfg.highHighPercent;
  }

  o["mode"] = ag::modeName(safety.mode());
  o["phase"] = ag::phaseName(safety.phase());
  o["armed"] = safety.armed();
  o["commissioned"] = cfg.commissioned;
  o["remoteControl"] = net.remoteControl;
  o["muted"] = safety.muted();
  if (net.sleepEnabled) {
    JsonObject power = o["power"].to<JsonObject>();
    power["sleepMinutes"] = net.sleepMinutes;
    // Set just before a power-saving sleep: when the next report is due.
    if (sleepUntilEpoch) power["sleepUntil"] = static_cast<uint32_t>(sleepUntilEpoch);
  }

  JsonObject valve = o["valve"].to<JsonObject>();
  // Commanded state only: there is no flow or position feedback.
  valve["commanded"] = safety.valveRequest();
  valve["fillRuntimeS"] = safety.fillRuntimeS(now);
  valve["manualRemainingS"] = safety.manualRemainingS(now);
  valve["openBlocker"] = ag::denyName(safety.openBlocker());
  valve["fillCount"] = safety.fillCount();
  valve["lastFillS"] = safety.lastFillDurationS();

  JsonObject in = o["inputs"].to<JsonObject>();
  in["floatHealthy"] = inputs.floatHealthy;
  in["estopHealthy"] = inputs.estopHealthy;
  in["k1Enabled"] = inputs.k1Enabled;

  JsonArray faults = o["faults"].to<JsonArray>();
  for (uint16_t bit = 1; bit <= ag::kFaultConfig; bit <<= 1) {
    if (safety.faults() & bit) faults.add(ag::faultName(bit));
  }
  JsonArray warnings = o["warnings"].to<JsonArray>();
  if (pipeline.warning() && !(safety.faults() & ag::kFaultSensor)) warnings.add("SENSOR_WARNING");
  if (!valid && !(safety.faults() & ag::kFaultSensor)) warnings.add("SENSOR_STALE");
  if (safety.noProgressWarning()) warnings.add("NO_PROGRESS_WARNING");
  if (safety.retryRemainingS(now)) warnings.add("RETRY_WAIT");
  if (!cfg.commissioned) warnings.add("NOT_COMMISSIONED");
  if (safety.lockout()) warnings.add("LOCKOUT");

  o["lastDeny"] = ag::denyName(safety.lastDeny());
  o["maintenanceRemainingS"] = safety.maintenanceRemainingS(now);
  o["retryRemainingS"] = safety.retryRemainingS(now);
  if (cfgError) o["configError"] = cfgError;

  JsonObject wifi = o["wifi"].to<JsonObject>();
  wifi["connected"] = wifiUp;
  wifi["rssi"] = rssi;
  wifi["ip"] = ip;
}

void fillConfig(JsonObject o) {
  Lock l;
  storage::configToJson(cfg, o);
  o["revision"] = cfgRevision;
  o["valid"] = cfgValid;
}

void fillDiag(JsonObject o) {
  Lock l;
  const uint32_t now = millis();
  o["fw"] = AQUAGUARD_FW_VERSION;
  o["schema"] = AQUAGUARD_DATA_SCHEMA;
  o["built"] = __DATE__ " " __TIME__;
  o["resetReason"] = static_cast<int>(esp_reset_reason());
  o["heapFree"] = ESP.getFreeHeap();
  o["heapMin"] = ESP.getMinFreeHeap();
  o["psramFree"] = ESP.getFreePsram();
  o["flashSize"] = ESP.getFlashChipSize();

  JsonObject uart = o["uart"].to<JsonObject>();
  uart["frames"] = parser.frames();
  uart["checksumFailures"] = parser.checksumFailures();
  uart["garbageBytes"] = parser.garbageBytes();
  char raw[12];
  const uint8_t* r = parser.lastRaw();
  snprintf(raw, sizeof(raw), "%02X %02X %02X %02X", r[0], r[1], r[2], r[3]);
  uart["lastRaw"] = raw;

  JsonObject s = o["sensor"].to<JsonObject>();
  s["lastRawMm"] = pipeline.lastRawMm();
  s["medianMm"] = pipeline.medianMm();
  s["windowCount"] = pipeline.windowCount();
  s["windowSize"] = cfg.medianSamples;
  s["invalidStreak"] = pipeline.invalidStreak();
  s["validOpportunities"] = pipeline.stats().validOpportunities;
  s["invalidOpportunities"] = pipeline.stats().invalidOpportunities;
  s["rangeRejects"] = pipeline.stats().rangeRejects;
  s["jumpRejects"] = pipeline.stats().jumpRejects;
  s["rebaselines"] = pipeline.stats().rebaselines;
  s["staleAgeMs"] = pipeline.hasTrusted() ? pipeline.ageMs(now) : 0;
  s["hasTrusted"] = pipeline.hasTrusted();
  float cal = 0.0f;
  s["calibrationReady"] = pipeline.calibrationMedianCm(&cal);
  s["calibrationMedianCm"] = cal;
}

void fillEvent(JsonObject o, const LogEntry& e) {
  o["seq"] = e.seq;
  o["uptimeS"] = e.uptimeS;
  o["ts"] = e.epoch;
  o["event"] = ag::eventName(e.event);
  o["arg"] = e.arg;
  // Human-readable detail for the events whose argument is an enum.
  switch (e.event) {
    case ag::Event::FaultRaised:
      o["detail"] = ag::faultName(static_cast<uint16_t>(e.arg));
      break;
    case ag::Event::CommandDenied:
    case ag::Event::FillStopped:
      o["detail"] = ag::denyName(static_cast<ag::Deny>(e.arg));
      break;
    case ag::Event::ModeChanged:
      o["detail"] = ag::modeName(static_cast<ag::Mode>(e.arg));
      break;
    default:
      break;
  }
}

}  // namespace app
