#include "ag_safety.h"

namespace ag {

namespace {
constexpr uint32_t kMinuteMs = 60000UL;
// Wrap-safe "deadline reached" for millis()-style counters.
bool reached(uint32_t nowMs, uint32_t deadlineMs) {
  return static_cast<int32_t>(nowMs - deadlineMs) >= 0;
}
uint32_t remainingS(uint32_t nowMs, uint32_t deadlineMs) {
  const int32_t left = static_cast<int32_t>(deadlineMs - nowMs);
  return left > 0 ? static_cast<uint32_t>(left) / 1000u : 0u;
}
}  // namespace

const char* modeName(Mode m) {
  switch (m) {
    case Mode::Auto: return "AUTO";
    case Mode::Manual: return "MANUAL";
    case Mode::Maintenance: return "MAINTENANCE";
  }
  return "UNKNOWN";
}

const char* phaseName(Phase p) {
  switch (p) {
    case Phase::Disarmed: return "DISARMED";
    case Phase::Idle: return "IDLE";
    case Phase::Filling: return "FILLING";
    case Phase::Fault: return "FAULT";
    case Phase::RetryWait: return "RETRY_WAIT";
  }
  return "UNKNOWN";
}

const char* denyName(Deny d) {
  switch (d) {
    case Deny::None: return "NONE";
    case Deny::Lockout: return "LOCKOUT";
    case Deny::ConfigInvalid: return "CONFIG_INVALID";
    case Deny::NotCommissioned: return "NOT_COMMISSIONED";
    case Deny::EStopActive: return "E_STOP_ACTIVE";
    case Deny::FloatLoopFault: return "FLOAT_LOOP_FAULT";
    case Deny::FloatClearDelay: return "FLOAT_CLEAR_DELAY";
    case Deny::K1Disabled: return "K1_DISABLED";
    case Deny::SensorFault: return "SENSOR_FAULT";
    case Deny::SensorStale: return "SENSOR_STALE";
    case Deny::FillTimeout: return "FILL_TIMEOUT";
    case Deny::NoProgress: return "NO_PROGRESS";
    case Deny::Disarmed: return "DISARMED";
    case Deny::LevelHigh: return "LEVEL_HIGH";
    case Deny::WrongMode: return "WRONG_MODE";
    case Deny::LocalAckRequired: return "LOCAL_ACK_REQUIRED";
    case Deny::RemoteDisabled: return "REMOTE_DISABLED";
    case Deny::BadRequest: return "BAD_REQUEST";
  }
  return "UNKNOWN";
}

const char* faultName(uint16_t bit) {
  switch (bit) {
    case kFaultEStop: return "EMERGENCY_STOP";
    case kFaultFloat: return "HIGH_LEVEL_OR_FLOAT_LOOP_FAULT";
    case kFaultSystem: return "SYSTEM_FAULT_K1";
    case kFaultSensor: return "SENSOR_FAULT";
    case kFaultFillTimeout: return "FILL_TIMEOUT";
    case kFaultNoProgress: return "NO_PROGRESS";
    case kFaultConfig: return "CONFIG_FAULT";
  }
  return "UNKNOWN";
}

const char* eventName(Event e) {
  switch (e) {
    case Event::Boot: return "BOOT";
    case Event::Armed: return "ARMED";
    case Event::ModeChanged: return "MODE_CHANGED";
    case Event::FillStart: return "FILL_START";
    case Event::FillComplete: return "FILL_COMPLETE";
    case Event::FillStopped: return "FILL_STOPPED";
    case Event::FaultRaised: return "FAULT_RAISED";
    case Event::FaultsCleared: return "FAULTS_CLEARED";
    case Event::CommandDenied: return "COMMAND_DENIED";
    case Event::Acknowledged: return "ACKNOWLEDGED";
    case Event::ConfigChanged: return "CONFIG_CHANGED";
    case Event::NoProgressWarning: return "NO_PROGRESS_WARNING";
    case Event::RetryScheduled: return "RETRY_SCHEDULED";
    case Event::ManualOpen: return "MANUAL_OPEN";
    case Event::MaintenanceEnded: return "MAINTENANCE_ENDED";
    case Event::Calibrated: return "CALIBRATED";
    case Event::OtaStarted: return "OTA_STARTED";
    case Event::SettingsRejected: return "SETTINGS_REJECTED";
  }
  return "UNKNOWN";
}

void SafetyManager::emit(Event e, int32_t arg) {
  if (sink_) sink_(sinkCtx_, e, arg);
}

Deny SafetyManager::deny(Deny d) {
  lastDeny_ = d;
  if (d != Deny::None) emit(Event::CommandDenied, static_cast<int32_t>(d));
  return d;
}

void SafetyManager::raise(uint16_t bit) {
  if (faults_ & bit) return;
  faults_ |= bit;
  muted_ = false;  // a new fault always sounds again
  emit(Event::FaultRaised, bit);
}

void SafetyManager::begin(const Config& cfg, bool configValid, uint16_t restoredFaults, uint32_t nowMs) {
  cfg_ = cfg;
  configValid_ = configValid;
  valveOpen_ = false;
  armed_ = false;  // restart policy: always acknowledge before arming
  lockout_ = false;
  mode_ = Mode::Auto;
  faults_ = restoredFaults & kPersistentFaults;
  if (!configValid) faults_ |= kFaultConfig;
  floatWasHealthy_ = false;
  floatHealthySinceMs_ = nowMs;
  k1Mismatch_ = false;
  retryWait_ = false;
  noProgressWarning_ = false;
  emit(Event::Boot, faults_);
}

void SafetyManager::applyConfig(const Config& cfg, uint32_t nowMs) {
  if (valveOpen_) endFill(nowMs, Deny::Lockout, false);
  cfg_ = cfg;
  configValid_ = true;
  faults_ &= static_cast<uint16_t>(~kFaultConfig);
  if (!cfg_.commissioned) armed_ = false;
  emit(Event::ConfigChanged);
}

void SafetyManager::setConfigValid(bool valid) {
  configValid_ = valid;
  if (!valid) raise(kFaultConfig);
}

void SafetyManager::setLockout(bool on, uint32_t nowMs) {
  lockout_ = on;
  if (on && valveOpen_) endFill(nowMs, Deny::Lockout, false);
}

void SafetyManager::disarm(uint32_t nowMs) {
  if (valveOpen_) endFill(nowMs, Deny::Disarmed, false);
  armed_ = false;
}

Deny SafetyManager::openBlocker() const {
  if (lockout_) return Deny::Lockout;
  if (!configValid_ || (faults_ & kFaultConfig)) return Deny::ConfigInvalid;
  if (!cfg_.commissioned) return Deny::NotCommissioned;
  if ((faults_ & kFaultEStop) || !in_.estopHealthy) return Deny::EStopActive;
  if ((faults_ & kFaultFloat) || !in_.floatHealthy) return Deny::FloatLoopFault;
  if ((faults_ & kFaultSystem) || !in_.k1Enabled) return Deny::K1Disabled;
  if ((faults_ & kFaultSensor) || in_.sensorCritical) return Deny::SensorFault;
  if (!in_.levelValid) return Deny::SensorStale;
  if (faults_ & kFaultFillTimeout) return Deny::FillTimeout;
  if (faults_ & kFaultNoProgress) return Deny::NoProgress;
  if (!armed_) return Deny::Disarmed;
  if (in_.levelPercent >= cfg_.stopFillPercent) return Deny::LevelHigh;
  return Deny::None;
}

Phase SafetyManager::phase() const {
  if (faults_) return Phase::Fault;
  if (!armed_) return Phase::Disarmed;
  if (valveOpen_) return Phase::Filling;
  if (retryWait_) return Phase::RetryWait;
  return Phase::Idle;
}

void SafetyManager::startFill(uint32_t nowMs, bool manual) {
  valveOpen_ = true;
  manualFill_ = manual;
  fillStartMs_ = nowMs;
  progressAtMs_ = nowMs;
  progressRefPercent_ = in_.levelPercent;
  noProgressWarning_ = false;
  retryWait_ = false;
  if (manual) manualDeadlineMs_ = nowMs + cfg_.manualOpenMinutes * kMinuteMs;
  emit(Event::FillStart, static_cast<int32_t>(in_.levelPercent * 10.0f));
}

void SafetyManager::endFill(uint32_t nowMs, Deny reason, bool completed) {
  if (!valveOpen_) return;
  valveOpen_ = false;
  lastFillDurationS_ = (nowMs - fillStartMs_) / 1000u;
  if (completed) {
    fillCount_++;
    emit(Event::FillComplete, static_cast<int32_t>(lastFillDurationS_));
  } else {
    emit(Event::FillStopped, static_cast<int32_t>(reason));
  }
}

void SafetyManager::tick(uint32_t nowMs, const SafetyInputs& in) {
  in_ = in;

  // ---- 1. Latch faults from the monitored inputs.
  if (!in.estopHealthy) raise(kFaultEStop);

  if (!in.floatHealthy) {
    raise(kFaultFloat);
    floatWasHealthy_ = false;
  } else if (!floatWasHealthy_) {
    floatWasHealthy_ = true;
    floatHealthySinceMs_ = nowMs;
  }

  // K1 is energised exactly when both interlock loops are closed. A lasting
  // disagreement means a coil, supply, relay or monitor wiring problem.
  const bool k1Expected = in.floatHealthy && in.estopHealthy;
  if (in.k1Enabled != k1Expected) {
    if (!k1Mismatch_) {
      k1Mismatch_ = true;
      k1MismatchSinceMs_ = nowMs;
    } else if (nowMs - k1MismatchSinceMs_ >= kK1MismatchMs) {
      raise(kFaultSystem);
    }
  } else {
    k1Mismatch_ = false;
  }

  if (in.sensorCritical) raise(kFaultSensor);
  if (!configValid_) raise(kFaultConfig);

  // ---- 2. Supervise a fill in progress. Closing never waits for anything.
  if (valveOpen_) {
    const Deny blocker = openBlocker();
    if (blocker == Deny::LevelHigh) {
      endFill(nowMs, Deny::None, true);
    } else if (blocker != Deny::None) {
      endFill(nowMs, blocker, false);
    } else if (nowMs - fillStartMs_ >= cfg_.maximumFillMinutes * kMinuteMs) {
      raise(kFaultFillTimeout);
      endFill(nowMs, Deny::FillTimeout, false);
    } else if (manualFill_ && reached(nowMs, manualDeadlineMs_)) {
      endFill(nowMs, Deny::None, true);
    } else {
      if (in.levelPercent >= progressRefPercent_ + cfg_.minRisePercent) {
        progressRefPercent_ = in.levelPercent;
        progressAtMs_ = nowMs;
        noProgressWarning_ = false;
      }
      const uint32_t flat = nowMs - progressAtMs_;
      if (flat >= cfg_.noProgressStopMinutes * kMinuteMs) {
        if (cfg_.autoRetry && !manualFill_) {
          retryWait_ = true;
          retryAtMs_ = nowMs + cfg_.retryMinutes * kMinuteMs;
          emit(Event::RetryScheduled, cfg_.retryMinutes);
        } else {
          raise(kFaultNoProgress);
        }
        endFill(nowMs, Deny::NoProgress, false);
      } else if (flat >= cfg_.progressWindowMinutes * kMinuteMs && !noProgressWarning_) {
        noProgressWarning_ = true;
        muted_ = false;
        emit(Event::NoProgressWarning);
      }
    }
  }

  // ---- 3. Mode timers.
  if (mode_ == Mode::Maintenance &&
      nowMs - maintenanceStartMs_ >= cfg_.maintenanceMinutes * kMinuteMs) {
    if (valveOpen_) endFill(nowMs, Deny::None, true);
    mode_ = modeBeforeMaintenance_;
    emit(Event::MaintenanceEnded);
    emit(Event::ModeChanged, static_cast<int32_t>(mode_));
  }

  if (retryWait_ && reached(nowMs, retryAtMs_)) retryWait_ = false;

  // ---- 4. Automatic start with hysteresis: open at start, close at stop.
  if (!valveOpen_ && mode_ == Mode::Auto && !retryWait_ &&
      in.levelValid && in.levelPercent <= cfg_.startFillPercent &&
      openBlocker() == Deny::None) {
    startFill(nowMs, false);
  }

  if (!valveOpen_ && !faults_) noProgressWarning_ = noProgressWarning_ && retryWait_;
}

Deny SafetyManager::requestMode(Mode m, uint32_t nowMs) {
  if (m == mode_) return Deny::None;
  if (lockout_ && m != Mode::Manual) return deny(Deny::Lockout);
  if (m == Mode::Maintenance) {
    modeBeforeMaintenance_ = mode_;
    maintenanceStartMs_ = nowMs;
  }
  // Every mode change starts from a closed valve.
  if (valveOpen_) endFill(nowMs, Deny::None, false);
  retryWait_ = false;
  mode_ = m;
  emit(Event::ModeChanged, static_cast<int32_t>(m));
  return Deny::None;
}

Deny SafetyManager::requestOpen(uint32_t nowMs) {
  if (mode_ == Mode::Auto) return deny(Deny::WrongMode);
  const Deny blocker = openBlocker();
  if (blocker != Deny::None) return deny(blocker);
  if (!valveOpen_) {
    startFill(nowMs, true);
    emit(Event::ManualOpen, cfg_.manualOpenMinutes);
  }
  return Deny::None;
}

Deny SafetyManager::requestClose(uint32_t nowMs) {
  // CLOSE is always honoured. In AUTO it also drops to MANUAL, otherwise the
  // controller would reopen as soon as the level is at or below the start point.
  if (valveOpen_) endFill(nowMs, Deny::None, false);
  retryWait_ = false;
  if (mode_ == Mode::Auto) {
    mode_ = Mode::Manual;
    emit(Event::ModeChanged, static_cast<int32_t>(mode_));
  }
  return Deny::None;
}

Deny SafetyManager::acknowledge(uint32_t nowMs, bool local) {
  if (lockout_) return deny(Deny::Lockout);
  if (!local && (faults_ & kFaultEStop)) return deny(Deny::LocalAckRequired);

  uint16_t clear = 0;
  Deny remaining = Deny::None;

  if (faults_ & kFaultConfig) {
    if (configValid_) clear |= kFaultConfig; else remaining = Deny::ConfigInvalid;
  }
  if (faults_ & kFaultEStop) {
    if (in_.estopHealthy) clear |= kFaultEStop;
    else if (remaining == Deny::None) remaining = Deny::EStopActive;
  }
  if (faults_ & kFaultFloat) {
    if (!in_.floatHealthy) {
      if (remaining == Deny::None) remaining = Deny::FloatLoopFault;
    } else if (nowMs - floatHealthySinceMs_ < cfg_.floatClearDelaySeconds * 1000UL) {
      if (remaining == Deny::None) remaining = Deny::FloatClearDelay;
    } else {
      clear |= kFaultFloat;
    }
  }
  if (faults_ & kFaultSystem) {
    const bool consistent = in_.k1Enabled == (in_.floatHealthy && in_.estopHealthy);
    if (consistent) clear |= kFaultSystem;
    else if (remaining == Deny::None) remaining = Deny::K1Disabled;
  }
  if (faults_ & kFaultSensor) {
    if (in_.levelValid && !in_.sensorCritical) clear |= kFaultSensor;
    else if (remaining == Deny::None) remaining = Deny::SensorFault;
  }
  clear |= faults_ & (kFaultFillTimeout | kFaultNoProgress);

  if (clear) {
    faults_ &= static_cast<uint16_t>(~clear);
    k1Mismatch_ = false;
    emit(Event::FaultsCleared, clear);
  }
  emit(Event::Acknowledged, faults_);
  if (remaining != Deny::None) return deny(remaining);

  // No latches left. Arm only when every live input is healthy too.
  if (!configValid_) return deny(Deny::ConfigInvalid);
  if (!cfg_.commissioned) return deny(Deny::NotCommissioned);
  if (!in_.estopHealthy) return deny(Deny::EStopActive);
  if (!in_.floatHealthy) return deny(Deny::FloatLoopFault);
  if (!in_.k1Enabled) return deny(Deny::K1Disabled);
  if (!in_.levelValid) return deny(Deny::SensorStale);
  if (!armed_) {
    armed_ = true;
    emit(Event::Armed);
  }
  lastDeny_ = Deny::None;
  return Deny::None;
}

uint32_t SafetyManager::fillRuntimeS(uint32_t nowMs) const {
  return valveOpen_ ? (nowMs - fillStartMs_) / 1000u : 0u;
}
uint32_t SafetyManager::manualRemainingS(uint32_t nowMs) const {
  return (valveOpen_ && manualFill_) ? remainingS(nowMs, manualDeadlineMs_) : 0u;
}
uint32_t SafetyManager::maintenanceRemainingS(uint32_t nowMs) const {
  if (mode_ != Mode::Maintenance) return 0u;
  return remainingS(nowMs, maintenanceStartMs_ + cfg_.maintenanceMinutes * kMinuteMs);
}
uint32_t SafetyManager::retryRemainingS(uint32_t nowMs) const {
  return retryWait_ ? remainingS(nowMs, retryAtMs_) : 0u;
}

}  // namespace ag
