// Optional power saving: deep sleep between checks while the tank is idle.
// Off by default. See power.cpp for the conditions.
#pragma once
#include <stdint.h>

namespace power {
// Call once, right after app::begin(). Reads why the chip started.
void begin();
// Call from loop(). May not return: it starts deep sleep when allowed.
void loop();
// Someone is using the local dashboard: stay awake for a while.
void noteActivity();
// True when this start is a wake from a power-saving sleep.
bool wokeFromSleep();
}  // namespace power
