#pragma once
#include <stdint.h>

namespace control {
// Call first thing in setup(), before anything else can fail or block.
void holdValveClosed();
// Start inputs, the sensor UART, the watchdog and the 20 ms control task.
void begin();
// Enter deep sleep with the valve request held LOW. Returns without sleeping
// if the valve is requested open; otherwise it does not return.
void deepSleep(uint64_t microseconds);
}  // namespace control
