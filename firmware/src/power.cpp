// Power saving (optional, off by default).
//
// While asleep the unit cannot measure, fill, show anything or answer the
// dashboard, the phone app or a firmware upload. It therefore only sleeps
// when nothing needs it awake, wakes on a timer to measure and report, and
// wakes at once when ACK is pressed. The hardware interlock (float loop and
// emergency stop through relay K1) does not depend on the processor and keeps
// working during sleep.
//
// A wake from deep sleep is a restart. The guide's restart policy is to boot
// disarmed; the one exception made here is a wake from a sleep that this code
// started while the unit was armed, healthy and idle. That state is carried in
// RTC memory, used once, and SafetyManager::resumeAfterSleep() still refuses
// to arm unless every input is healthy and no fault is latched.
#include "power.h"

#include <Arduino.h>
#include <esp_sleep.h>

#include "app.h"
#include "control.h"
#include "pins.h"
#include "ui.h"

namespace power {

namespace {
constexpr uint32_t kMagic = 0xA90A51EEu;
constexpr uint32_t kAwakeMs = 90UL * 1000UL;          // measure, connect, report, take requests
constexpr uint32_t kActivityHoldMs = 5UL * 60UL * 1000UL;
constexpr uint32_t kAnnounceMs = 8000;                // conditions must hold this long; status carries sleepUntil
constexpr uint32_t kResumeWindowMs = 20000;           // time allowed for inputs and level to settle
constexpr float kStartMarginPercent = 5.0f;           // stay awake when a fill may be needed soon

struct Carried {
  uint32_t magic;
  uint32_t armed;
};
RTC_DATA_ATTR Carried carried;

bool woke = false;
bool resumePending = false;
volatile uint32_t lastActivityMs = 0;
volatile bool anyActivity = false;
uint32_t announceSinceMs = 0;

// Everything that must be true to sleep. Requires the lock.
bool idleAndHealthy(uint32_t now) {
  const ag::SafetyManager& s = app::safety;
  if (!app::cfgValid || !app::cfg.commissioned) return false;
  if (!s.armed() || s.lockout() || s.faults() || s.valveRequest()) return false;
  if (s.mode() != ag::Mode::Auto || s.phase() != ag::Phase::Idle) return false;
  if (s.noProgressWarning()) return false;
  if (!app::pipeline.hasTrusted() || app::pipeline.isStale(now) || app::pipeline.warning()) return false;
  if (app::pipeline.trustedPercent() < app::cfg.startFillPercent + kStartMarginPercent) return false;
  if (!app::inputs.floatHealthy || !app::inputs.estopHealthy || !app::inputs.k1Enabled) return false;
  return true;
}
}  // namespace

void begin() {
  woke = esp_reset_reason() == ESP_RST_DEEPSLEEP;
  resumePending = woke && carried.magic == kMagic && carried.armed == 1;
  carried.magic = 0;  // single use: any other kind of restart boots disarmed
  carried.armed = 0;
  if (woke && esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0) noteActivity();  // ACK pressed
}

bool wokeFromSleep() { return woke; }

void noteActivity() {
  lastActivityMs = millis();
  anyActivity = true;
}

void loop() {
  const uint32_t now = millis();

  if (resumePending) {
    if (now > kResumeWindowMs) {
      resumePending = false;  // not healthy in time: stay disarmed
    } else if (now > 1500) {
      app::Lock l;
      if (app::safety.resumeAfterSleep(now) == ag::Deny::None) resumePending = false;
    }
  }

  bool ok = app::net.sleepEnabled && !resumePending && now >= kAwakeMs && !app::setupApActive &&
            !app::otaInProgress && digitalRead(PIN_ACK_BUTTON) == HIGH &&
            !(anyActivity && now - lastActivityMs < kActivityHoldMs);
  if (ok) {
    app::Lock l;
    ok = idleAndHealthy(now);
  }
  if (!ok) {
    announceSinceMs = 0;
    app::sleepUntilEpoch = 0;
    return;
  }

  const uint32_t sleepS = static_cast<uint32_t>(app::net.sleepMinutes) * 60UL;
  if (!announceSinceMs) {
    announceSinceMs = now ? now : 1;
    const uint32_t epoch = app::epochNow();
    app::sleepUntilEpoch = epoch ? epoch + kAnnounceMs / 1000 + sleepS : 0;
    return;
  }
  if (now - announceSinceMs < kAnnounceMs) return;

  carried.magic = kMagic;
  carried.armed = 1;
  ui::prepareSleep();
  control::deepSleep(static_cast<uint64_t>(sleepS) * 1000000ULL);
  // Only reached when the control code refused (a fill started just now).
  carried.magic = 0;
  carried.armed = 0;
  announceSinceMs = 0;
  app::sleepUntilEpoch = 0;
}

}  // namespace power
