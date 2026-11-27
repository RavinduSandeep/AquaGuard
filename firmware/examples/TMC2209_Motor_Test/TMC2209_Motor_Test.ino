// ESP32-S3 + Silent2209 V3.0: standalone STEP/DIR bench test.
// GPIO13 -> STEP, GPIO14 -> DIR, GPIO15 -> EN (active LOW).
// VIO=3.3V, VM=verified 12V, common GND, MS1=GND, MS2=GND.
// External resistors: 10k EN->3V3; 10k STEP->GND.
// Set the driver's current limit before connecting the motor.
// An A4988 module works with the same sketch: see Wiring_Guide_A4988.
// Test with the motor detached from the valve. No UART or extra library needed.
//
// Single keys at 115200 baud: f=forward jog, r=reverse jog, s=stop, ?=help,
// h=hold test (driver on for 20 s with no steps, for fault finding).
//
// Lines starting with @ are for the test page in tester/ (see Wiring_Guide):
//   @move <pulses> <speed> <accel>   relative move; negative pulses = reverse
//   @run <speed> <accel> <seconds>   turn continuously; negative speed = reverse
//   @stop                            slow down and stop
//   @keep 0|1                        keep the driver on after a move
//   @zero  @status  @watch 0|1
// speed is in pulses per second, accel in pulses per second squared (0 = none).
//
// Works through either USB socket of the dev kit: the one marked USB (native)
// or the one marked UART/COM (the CH343 bridge on GPIO43/44).

#include <Arduino.h>
#include <driver/gpio.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

constexpr uint8_t STEP_PIN = 13;
constexpr uint8_t DIR_PIN = 14;
constexpr uint8_t EN_PIN = 15;
constexpr int32_t JOG_PULSES = 400;
constexpr float JOG_SPEED = 200.0f;        // pulses/second
constexpr uint32_t STEP_HIGH_US = 5;
constexpr uint32_t ENABLE_SETTLE_US = 300000;
constexpr uint32_t DIR_SETTLE_US = 2000;   // driver already on: only DIR must settle
constexpr uint32_t HOLD_MS = 20000;
constexpr uint32_t IDLE_OFF_MS = 120000;   // "keep on" still switches off after 2 idle minutes
constexpr uint32_t STATUS_MS = 100;
constexpr float MAX_SPEED = 20000.0f;      // pulses/second
constexpr float MAX_ACCEL = 200000.0f;     // pulses/second^2
constexpr float MIN_RAMP_SPEED = 50.0f;
constexpr int32_t MAX_MOVE_PULSES = 2000000;
constexpr float MAX_RUN_SECONDS = 300.0f;
constexpr size_t LINE_BUFFER_SIZE = 64;

// With "USB CDC on boot" enabled, Serial is the native USB socket and Serial0 is
// the UART/COM socket, so messages and commands use both. Otherwise Serial is
// already the UART/COM socket.
#if ARDUINO_USB_CDC_ON_BOOT
Stream* const PORTS[] = {&Serial, &Serial0};
#else
Stream* const PORTS[] = {&Serial};
#endif
constexpr size_t PORT_COUNT = sizeof(PORTS) / sizeof(PORTS[0]);

enum LineState : uint8_t { KEYS, COLLECTING, DISCARDING };
char lineBuffer[PORT_COUNT][LINE_BUFFER_SIZE];
size_t lineLength[PORT_COUNT] = {};
LineState lineState[PORT_COUNT] = {};

bool moving = false;       // step pulses are being produced
bool continuous = false;   // @run: no pulse count, ends on stop or time limit
bool stopping = false;     // slowing down to a stop
bool jogging = false;      // started with f or r (only changes the messages)
bool holding = false;      // h hold test
bool driverOn = false;     // EN is LOW
bool keepOn = false;       // leave the driver on after a move
bool watching = false;     // send @st lines while moving
int8_t direction = 1;
int32_t pulsesLeft = 0;
int32_t position = 0;      // pulses since power-up or @zero, commanded not measured
float speed = 0.0f;        // current pulses/second
float targetSpeed = 0.0f;
float accel = 0.0f;
uint32_t nextStepUs = 0;
uint32_t holdStartMs = 0;
uint32_t runStartMs = 0;
uint32_t runLimitMs = 0;
uint32_t idleSinceMs = 0;
uint32_t lastStatusMs = 0;

void say(const char* message) {
  for (Stream* port : PORTS) port->println(message);
}

void sendStatus() {
  char text[96];
  const long signedSpeed = moving ? lroundf(speed) * direction : 0;
  snprintf(text, sizeof(text), "@st pos=%ld sps=%ld moving=%d on=%d keep=%d",
           static_cast<long>(position), signedSpeed, moving ? 1 : 0,
           driverOn ? 1 : 0, keepOn ? 1 : 0);
  say(text);
  lastStatusMs = millis();
}

void printHelp() {
  say("\nf = forward 400 pulses; r = reverse 400 pulses");
  say("h = hold test: driver on for 20 s, no steps (shaft should go stiff)");
  say("s = stop and disable; ? = show these commands");
  say("Unloaded bench test only. Direction names are relative.");
}

// Immediate stop: no more pulses and the driver is switched off.
void stopMotor() {
  moving = false;
  continuous = false;
  stopping = false;
  jogging = false;
  holding = false;
  pulsesLeft = 0;
  speed = 0.0f;
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(EN_PIN, HIGH);
  driverOn = false;
}

// Lowest speed of a ramp: also the speed a ramp starts from and ends at.
float floorSpeed() {
  if (accel <= 0.0f) return targetSpeed;
  float floor = sqrtf(2.0f * accel);
  if (floor < MIN_RAMP_SPEED) floor = MIN_RAMP_SPEED;
  return floor < targetSpeed ? floor : targetSpeed;
}

void beginMotion(bool reverse, bool endless, int32_t pulses, float maxSpeed, float ramp) {
  digitalWrite(DIR_PIN, reverse ? HIGH : LOW);
  const uint32_t settleUs = driverOn ? DIR_SETTLE_US : ENABLE_SETTLE_US;
  digitalWrite(EN_PIN, LOW);
  driverOn = true;
  direction = reverse ? -1 : 1;
  continuous = endless;
  stopping = false;
  pulsesLeft = pulses;
  targetSpeed = maxSpeed;
  accel = ramp;
  speed = floorSpeed();
  nextStepUs = micros() + settleUs;
  moving = true;
}

void finishMotion() {
  const bool wasJog = jogging;
  moving = false;
  continuous = false;
  stopping = false;
  jogging = false;
  speed = 0.0f;
  digitalWrite(STEP_PIN, LOW);
  if (keepOn) {
    idleSinceMs = millis();
    say(wasJog ? "Jog complete. Driver held on." : "Move complete. Driver held on.");
  } else {
    digitalWrite(EN_PIN, HIGH);
    driverOn = false;
    say(wasJog ? "Jog complete. Driver disabled." : "Move complete. Driver disabled.");
  }
  if (watching) sendStatus();
}

void startJog(bool reverse) {
  if (moving || holding) {
    say("Busy. Send s to stop before another command.");
    return;
  }
  beginMotion(reverse, false, JOG_PULSES, JOG_SPEED, 0.0f);
  jogging = true;
  say(reverse ? "Reverse jog started." : "Forward jog started.");
}

// Fault finding: switch the driver on without stepping. A powered, correctly
// wired motor resists turning by hand, and EN can be measured at 0 V.
void startHold() {
  if (moving || holding) {
    say("Busy. Send s to stop before another command.");
    return;
  }
  digitalWrite(EN_PIN, LOW);
  driverOn = true;
  holdStartMs = millis();
  holding = true;
  say("Hold test: driver ON for 20 s, no steps. Try turning the shaft by hand.");
}

// Reads the next number of an @ line. Returns false when there is none.
bool nextNumber(char*& cursor, float& value) {
  char* end = nullptr;
  value = strtof(cursor, &end);
  if (end == cursor || !isfinite(value)) return false;
  cursor = end;
  return true;
}

void handleLine(char* line) {
  char* cursor = line + 1;  // skip the @
  char* name = cursor;
  while (*cursor != '\0' && *cursor != ' ') ++cursor;
  if (*cursor == ' ') *cursor++ = '\0';
  float a = 0.0f, b = 0.0f, c = 0.0f;

  if (strcmp(name, "move") == 0) {
    if (!nextNumber(cursor, a) || !nextNumber(cursor, b) || !nextNumber(cursor, c)) { say("@err move needs: pulses speed accel"); return; }
    const int32_t pulses = static_cast<int32_t>(lroundf(fabsf(a)));
    if (pulses < 1 || pulses > MAX_MOVE_PULSES || b < 1.0f || b > MAX_SPEED || c < 0.0f || c > MAX_ACCEL) { say("@err value out of range"); return; }
    if (moving || holding) { say("@err busy"); return; }
    beginMotion(a < 0.0f, false, pulses, b, c);
    say("@ok move");
  } else if (strcmp(name, "run") == 0) {
    if (!nextNumber(cursor, a) || !nextNumber(cursor, b) || !nextNumber(cursor, c)) { say("@err run needs: speed accel seconds"); return; }
    const float wanted = fabsf(a);
    if (wanted < 1.0f || wanted > MAX_SPEED || b < 0.0f || b > MAX_ACCEL || c < 0.1f || c > MAX_RUN_SECONDS) { say("@err value out of range"); return; }
    const bool reverse = a < 0.0f;
    if (holding) { say("@err busy"); return; }
    if (moving) {
      // Already turning the same way: just change the speed.
      if (!continuous || stopping || (direction < 0) != reverse) { say("@err busy"); return; }
      targetSpeed = wanted;
      accel = b;
      if (accel <= 0.0f) speed = targetSpeed;
    } else {
      beginMotion(reverse, true, 0, wanted, b);
    }
    runStartMs = millis();
    runLimitMs = static_cast<uint32_t>(c * 1000.0f);
    say("@ok run");
  } else if (strcmp(name, "stop") == 0) {
    if (moving) stopping = true;
    say("@ok stop");
  } else if (strcmp(name, "keep") == 0) {
    if (!nextNumber(cursor, a)) { say("@err keep needs 0 or 1"); return; }
    keepOn = a != 0.0f;
    if (!keepOn && driverOn && !moving && !holding) {
      digitalWrite(EN_PIN, HIGH);
      driverOn = false;
    }
    say(keepOn ? "@ok keep 1" : "@ok keep 0");
    sendStatus();
  } else if (strcmp(name, "zero") == 0) {
    if (moving) { say("@err busy"); return; }
    position = 0;
    say("@ok zero");
    sendStatus();
  } else if (strcmp(name, "watch") == 0) {
    if (!nextNumber(cursor, a)) { say("@err watch needs 0 or 1"); return; }
    watching = a != 0.0f;
    sendStatus();
  } else if (strcmp(name, "status") == 0) {
    sendStatus();
  } else {
    say("@err unknown command");
  }
}

void handleKey(char key) {
  switch (key) {
    case 'f': case 'F': startJog(false); break;
    case 'r': case 'R': startJog(true); break;
    case 'h': case 'H': startHold(); break;
    case 's': case 'S':
      stopMotor();
      say("Stopped. Driver disabled.");
      if (watching) sendStatus();
      break;
    case '?': printHelp(); break;
    default: break;  // Ignore line endings and other characters.
  }
}

void readPort(size_t index) {
  Stream* port = PORTS[index];
  while (port->available() > 0) {
    const char c = static_cast<char>(port->read());
    const bool lineEnd = c == '\n' || c == '\r';
    if (lineState[index] == KEYS) {
      if (c == '@') {
        lineBuffer[index][0] = c;
        lineLength[index] = 1;
        lineState[index] = COLLECTING;
      } else {
        handleKey(c);
      }
    } else if (lineEnd) {
      if (lineState[index] == COLLECTING) {
        lineBuffer[index][lineLength[index]] = '\0';
        handleLine(lineBuffer[index]);
      }
      lineState[index] = KEYS;
    } else if (lineState[index] == COLLECTING) {
      if (lineLength[index] < LINE_BUFFER_SIZE - 1) {
        lineBuffer[index][lineLength[index]++] = c;
      } else {
        lineState[index] = DISCARDING;  // too long: drop it all, never read it as keys
        say("@err line too long");
      }
    }
  }
}

void setup() {
  // Preload the ESP32 output latch HIGH before making EN an output.
  gpio_set_level(static_cast<gpio_num_t>(EN_PIN), 1);
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, HIGH);
  pinMode(STEP_PIN, OUTPUT);
  digitalWrite(STEP_PIN, LOW);
  pinMode(DIR_PIN, OUTPUT);
  digitalWrite(DIR_PIN, LOW);

  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial0.begin(115200);
#endif
  delay(1000);
  say("TMC2209 ready. Motor disabled; no automatic movement.");
  printHelp();
}

void loop() {
  for (size_t i = 0; i < PORT_COUNT; ++i) readPort(i);

  if (holding && millis() - holdStartMs >= HOLD_MS) {
    stopMotor();
    say("Hold test finished. Driver disabled.");
  }

  if (moving && continuous && !stopping && millis() - runStartMs >= runLimitMs) {
    stopping = true;
  }

  if (driverOn && !moving && !holding && millis() - idleSinceMs >= IDLE_OFF_MS) {
    digitalWrite(EN_PIN, HIGH);
    driverOn = false;
    say("Idle for 2 minutes. Driver disabled.");
    if (watching) sendStatus();
  }

  if (moving && static_cast<int32_t>(micros() - nextStepUs) >= 0) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(STEP_HIGH_US);
    digitalWrite(STEP_PIN, LOW);
    position += direction;

    bool done = false;
    if (!continuous && --pulsesLeft == 0) {
      done = true;
    } else if (accel <= 0.0f) {
      if (stopping) done = true;
      else speed = targetSpeed;
    } else {
      const float change = accel / speed;  // speed gained or lost in one pulse
      const float floor = floorSpeed();
      const bool brake = stopping ||
          (!continuous && static_cast<float>(pulsesLeft) <= speed * speed / (2.0f * accel));
      if (brake) {
        if (speed - change <= floor) {
          if (stopping && speed <= floor) done = true;
          speed = floor;
        } else {
          speed -= change;
        }
      } else if (speed < targetSpeed) {
        speed = speed + change > targetSpeed ? targetSpeed : speed + change;
      } else if (speed > targetSpeed) {
        speed = speed - change < targetSpeed ? targetSpeed : speed - change;
      }
    }

    if (done) {
      finishMotion();
    } else {
      nextStepUs += static_cast<uint32_t>(1000000.0f / speed);
      // Fell behind by more than a whole pulse: carry on from now, no burst.
      if (static_cast<int32_t>(micros() - nextStepUs) > 0) nextStepUs = micros();
    }
  }

  if (watching && moving && millis() - lastStatusMs >= STATUS_MS) sendStatus();
}
