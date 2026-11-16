#include "ag_schedule.h"

#include <string.h>

namespace ag {

namespace {
void windowFor(const Config& c, uint8_t dayOfWeek, uint16_t& start, uint16_t& end) {
  const bool weekend = dayOfWeek == 0 || dayOfWeek == 6;
  start = weekend ? c.weekendStartMin : c.weekdayStartMin;
  end = weekend ? c.weekendEndMin : c.weekdayEndMin;
}
}  // namespace

bool scheduleAllows(const Config& c, uint8_t dayOfWeek, uint16_t minuteOfDay) {
  if (!c.scheduleEnabled) return true;
  dayOfWeek %= 7;
  uint16_t start, end;
  windowFor(c, dayOfWeek, start, end);
  if (start < end) {
    if (minuteOfDay >= start && minuteOfDay < end) return true;
  } else if (minuteOfDay >= start) {
    return true;  // today's window runs past midnight
  }
  // The tail of a window that started yesterday and ran past midnight.
  windowFor(c, static_cast<uint8_t>((dayOfWeek + 6) % 7), start, end);
  return start > end && minuteOfDay < end;
}

bool scheduleAllowsAt(const Config& c, uint32_t epochUtc) {
  if (!c.scheduleEnabled || epochUtc == 0) return true;
  const int64_t local = static_cast<int64_t>(epochUtc) + static_cast<int64_t>(c.utcOffsetMinutes) * 60;
  if (local < 0) return true;
  const int64_t days = local / 86400;
  const uint8_t dow = static_cast<uint8_t>((days + 4) % 7);  // 1 January 1970 was a Thursday
  const uint16_t minute = static_cast<uint16_t>((local % 86400) / 60);
  return scheduleAllows(c, dow, minute);
}

bool pinFormatValid(const char* pin) {
  if (!pin) return false;
  const size_t n = strlen(pin);
  if (n < 4 || n > 8) return false;
  for (size_t i = 0; i < n; i++) {
    if (pin[i] < '0' || pin[i] > '9') return false;
  }
  return true;
}

PinResult PinGuard::check(const char* given, const char* expected, uint32_t nowMs) {
  if (locked_) {
    if (nowMs - lockedAtMs_ < kLockMs) return PinResult::Locked;
    locked_ = false;
    wrong_ = 0;
  }
  bool same = given && expected && pinFormatValid(expected) && strlen(given) == strlen(expected);
  if (same) {
    uint8_t diff = 0;  // compare every character whatever the result
    for (size_t i = 0; expected[i]; i++) diff |= static_cast<uint8_t>(given[i] ^ expected[i]);
    same = diff == 0;
  }
  if (same) {
    wrong_ = 0;
    return PinResult::Ok;
  }
  if (++wrong_ >= kMaxWrong) {
    locked_ = true;
    lockedAtMs_ = nowMs;
  }
  return PinResult::Wrong;
}

uint32_t PinGuard::lockedRemainingS(uint32_t nowMs) const {
  if (!locked_) return 0;
  const uint32_t elapsed = nowMs - lockedAtMs_;
  return elapsed < kLockMs ? (kLockMs - elapsed) / 1000u : 0u;
}

}  // namespace ag
