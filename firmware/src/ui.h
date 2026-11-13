#pragma once

namespace ui {
void begin();
void loop();
// True when the ACK button is held while powering up (starts the setup AP).
bool ackHeldAtBoot();
}  // namespace ui
