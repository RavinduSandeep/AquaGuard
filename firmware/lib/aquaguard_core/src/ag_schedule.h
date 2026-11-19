// AquaGuard core - supply schedule and the settings PIN guard.
// Pure C++ so both are covered by the native unit tests.
#pragma once
#include <stdint.h>

#include "ag_config.h"

namespace ag {

// True when automatic filling is allowed at this local time.
// dayOfWeek: 0 = Sunday .. 6 = Saturday; each day has its own window, and a
// day switched off in scheduleDays has none. A window whose start is after
// its end runs past midnight and belongs to the day it started on. Always
// true when the schedule is off.
bool scheduleAllows(const Config& c, uint8_t dayOfWeek, uint16_t minuteOfDay);

// Same, from UTC epoch seconds and the configured UTC offset. With an unknown
// clock (epoch 0) the schedule cannot be applied and filling is allowed, so a
// lost clock never leaves the tank empty.
bool scheduleAllowsAt(const Config& c, uint32_t epochUtc);

// A settings PIN is 4 to 8 digits.
bool pinFormatValid(const char* pin);

enum class PinResult : uint8_t { Ok, Wrong, Locked };

// Slows down guessing: after kMaxWrong wrong PINs in a row every attempt,
// right or wrong, is refused for kLockMs.
class PinGuard {
 public:
  static constexpr uint8_t kMaxWrong = 5;
  static constexpr uint32_t kLockMs = 5UL * 60000UL;

  PinResult check(const char* given, const char* expected, uint32_t nowMs);
  uint32_t lockedRemainingS(uint32_t nowMs) const;

 private:
  uint8_t wrong_ = 0;
  bool locked_ = false;
  uint32_t lockedAtMs_ = 0;
};

}  // namespace ag
