#pragma once

namespace control {
// Call first thing in setup(), before anything else can fail or block.
void holdValveClosed();
// Start inputs, the sensor UART, the watchdog and the 20 ms control task.
void begin();
}  // namespace control
