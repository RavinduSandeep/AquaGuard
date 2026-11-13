#pragma once
#include <stdint.h>

namespace cloud {
enum class State : uint8_t { Disabled, Offline, WaitingForTime, AuthFailed, Error, Online };
void begin();
State currentState();
const char* stateName(State s);
}  // namespace cloud
