// AquaGuard core - SafetyManager: the single authority for the valve request.
// Implements the operating logic and fault priorities of guide section 12.
// Nothing else in the firmware may drive the valve GPIO; callers submit
// requests here and copy valveRequest() to the pin.
//
// The hardware interlock (float loop + emergency stop through relay K1) acts
// on its own and does not depend on this code.
#pragma once
#include <stdint.h>

#include "ag_config.h"

namespace ag {

enum class Mode : uint8_t { Auto, Manual, Maintenance };

enum class Phase : uint8_t { Disarmed, Idle, Filling, Fault, RetryWait };

// Latched faults. Each one inhibits filling until acknowledged while healthy.
enum Fault : uint16_t {
  kFaultEStop = 1 << 0,        // EMERGENCY_STOP
  kFaultFloat = 1 << 1,        // HIGH LEVEL OR FLOAT LOOP FAULT
  kFaultSystem = 1 << 2,       // K1 feedback disagrees with the interlock inputs
  kFaultSensor = 1 << 3,       // SENSOR_FAULT (critical)
  kFaultFillTimeout = 1 << 4,  // FILL_TIMEOUT
  kFaultNoProgress = 1 << 5,   // no level rise while the valve was requested open
  kFaultConfig = 1 << 6,       // stored configuration invalid or unreadable
};
// Faults remembered across a reboot so a power cycle cannot clear them.
constexpr uint16_t kPersistentFaults = kFaultEStop | kFaultFloat | kFaultFillTimeout;

enum class Deny : uint8_t {
  None,
  Lockout,           // OTA or calibration in progress
  ConfigInvalid,
  NotCommissioned,
  EStopActive,
  FloatLoopFault,
  FloatClearDelay,   // float healthy but not yet for floatClearDelaySeconds
  K1Disabled,
  SensorFault,
  SensorStale,
  FillTimeout,
  NoProgress,
  Disarmed,
  LevelHigh,
  WrongMode,         // OPEN is only accepted in MANUAL or MAINTENANCE
  LocalAckRequired,  // emergency stop must be acknowledged at the unit
  RemoteDisabled,
  BadRequest,
};

enum class Event : uint8_t {
  Boot,
  Armed,
  ModeChanged,     // arg = Mode
  FillStart,       // arg = level percent x10
  FillComplete,    // arg = fill duration in seconds
  FillStopped,     // arg = Deny reason that ended it (None = operator close)
  FaultRaised,     // arg = Fault bit
  FaultsCleared,   // arg = cleared mask
  CommandDenied,   // arg = Deny
  Acknowledged,
  ConfigChanged,
  NoProgressWarning,
  RetryScheduled,  // arg = minutes
  ManualOpen,      // arg = minutes allowed
  MaintenanceEnded,
  Calibrated,      // arg = distance mm; 0 = empty reference, 1 = full in high bit
  OtaStarted,
  SettingsRejected,
};

struct SafetyInputs {
  bool floatHealthy = false;   // GPIO4 LOW after debounce
  bool estopHealthy = false;   // GPIO5 LOW after debounce
  bool k1Enabled = false;      // GPIO11 LOW after debounce
  bool levelValid = false;     // trusted level exists and is not stale
  float levelPercent = 0.0f;   // only meaningful when levelValid
  bool sensorCritical = false; // invalid-opportunity count reached faultCount
};

using EventSink = void (*)(void* ctx, Event e, int32_t arg);

const char* modeName(Mode m);
const char* phaseName(Phase p);
const char* denyName(Deny d);
const char* faultName(uint16_t bit);
const char* eventName(Event e);

class SafetyManager {
 public:
  static constexpr uint32_t kK1MismatchMs = 500;

  // `restoredFaults` are persistent latches read back from storage at boot.
  void begin(const Config& cfg, bool configValid, uint16_t restoredFaults, uint32_t nowMs);
  void setEventSink(EventSink sink, void* ctx) { sink_ = sink; sinkCtx_ = ctx; }

  // Apply a validated configuration. Always ends any fill in progress.
  void applyConfig(const Config& cfg, uint32_t nowMs);
  void setConfigValid(bool valid);
  // Lockout closes the valve and refuses OPEN (OTA upload, calibration write).
  void setLockout(bool on, uint32_t nowMs);
  // Used before a firmware update: close and require a fresh acknowledgement.
  void disarm(uint32_t nowMs);

  // Run about every 20 ms.
  void tick(uint32_t nowMs, const SafetyInputs& in);

  // Requests. Each returns Deny::None when accepted.
  Deny requestMode(Mode m, uint32_t nowMs);
  Deny requestOpen(uint32_t nowMs);
  Deny requestClose(uint32_t nowMs);
  Deny acknowledge(uint32_t nowMs, bool local);
  void mute() { muted_ = true; }

  // The one output that drives the valve.
  bool valveRequest() const { return valveOpen_; }

  Mode mode() const { return mode_; }
  Phase phase() const;
  bool armed() const { return armed_; }
  bool lockout() const { return lockout_; }
  uint16_t faults() const { return faults_; }
  bool noProgressWarning() const { return noProgressWarning_; }
  bool muted() const { return muted_; }
  Deny lastDeny() const { return lastDeny_; }
  // Why OPEN would be refused right now (None = it would be accepted).
  Deny openBlocker() const;

  uint32_t fillRuntimeS(uint32_t nowMs) const;
  uint32_t manualRemainingS(uint32_t nowMs) const;
  uint32_t maintenanceRemainingS(uint32_t nowMs) const;
  uint32_t retryRemainingS(uint32_t nowMs) const;
  uint32_t fillCount() const { return fillCount_; }
  uint32_t lastFillDurationS() const { return lastFillDurationS_; }

 private:
  void emit(Event e, int32_t arg = 0);
  void raise(uint16_t bit);
  void startFill(uint32_t nowMs, bool manual);
  void endFill(uint32_t nowMs, Deny reason, bool completed);
  Deny deny(Deny d);

  Config cfg_;
  bool configValid_ = false;
  EventSink sink_ = nullptr;
  void* sinkCtx_ = nullptr;

  SafetyInputs in_;
  Mode mode_ = Mode::Auto;
  Mode modeBeforeMaintenance_ = Mode::Auto;
  bool armed_ = false;
  bool lockout_ = false;
  bool muted_ = false;
  uint16_t faults_ = 0;
  Deny lastDeny_ = Deny::None;

  bool valveOpen_ = false;
  bool manualFill_ = false;
  uint32_t fillStartMs_ = 0;
  uint32_t manualDeadlineMs_ = 0;
  uint32_t progressAtMs_ = 0;
  float progressRefPercent_ = 0.0f;
  bool noProgressWarning_ = false;

  bool retryWait_ = false;
  uint32_t retryAtMs_ = 0;
  uint32_t maintenanceStartMs_ = 0;

  bool floatWasHealthy_ = false;
  uint32_t floatHealthySinceMs_ = 0;
  bool k1Mismatch_ = false;
  uint32_t k1MismatchSinceMs_ = 0;

  uint32_t fillCount_ = 0;
  uint32_t lastFillDurationS_ = 0;
};

}  // namespace ag
