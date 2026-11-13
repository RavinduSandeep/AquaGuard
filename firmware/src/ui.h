#pragma once

namespace ui {
void begin();
void loop();
// True when the ACK button is held while powering up (starts the setup AP).
bool ackHeldAtBoot();
// Blank the display and pixels and silence the buzzer before deep sleep.
void prepareSleep();
}  // namespace ui
