// Local indication: SSD1306 OLED, eight WS2812 pixels, active buzzer and the
// ACK button. Runs from loop() and never blocks the control task.
#include "ui.h"

#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <Wire.h>

#include "app.h"
#include "pins.h"
#include "version.h"

namespace ui {

namespace {
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Adafruit_NeoPixel strip(WS2812_PIXELS, PIN_WS2812, NEO_GRB + NEO_KHZ800);
bool oledOk = false;

enum class Alarm : uint8_t { None, Warning, Fault, Emergency };

struct View {
  char tankName[24];
  bool hasLevel, levelValid, valveOpen, armed, muted, buzzerEnabled, commissioned;
  float percent, litres, startPct, stopPct;
  ag::Mode mode;
  ag::Phase phase;
  uint16_t faults;
  bool sensorWarning, noProgressWarning;
  uint8_t brightness;
  ag::Deny blocker;
};

View snapshot() {
  View v;
  app::Lock l;
  const uint32_t now = millis();
  strlcpy(v.tankName, app::cfg.tankName, sizeof(v.tankName));
  v.hasLevel = app::pipeline.hasTrusted();
  v.levelValid = !app::pipeline.isStale(now);
  v.percent = v.hasLevel ? app::pipeline.trustedPercent() : 0.0f;
  v.litres = ag::estimatedLitres(v.percent, app::cfg.usableCapacityLitres);
  v.startPct = app::cfg.startFillPercent;
  v.stopPct = app::cfg.stopFillPercent;
  v.valveOpen = app::safety.valveRequest();
  v.armed = app::safety.armed();
  v.muted = app::safety.muted();
  v.buzzerEnabled = app::cfg.buzzerEnabled;
  v.commissioned = app::cfg.commissioned;
  v.mode = app::safety.mode();
  v.phase = app::safety.phase();
  v.faults = app::safety.faults();
  v.sensorWarning = app::pipeline.warning();
  v.noProgressWarning = app::safety.noProgressWarning();
  v.brightness = app::cfg.ledBrightnessPercent;
  v.blocker = app::safety.openBlocker();
  return v;
}

Alarm alarmOf(const View& v) {
  if (v.faults & (ag::kFaultEStop | ag::kFaultFloat)) return Alarm::Emergency;
  if (v.faults) return Alarm::Fault;
  if (v.sensorWarning || v.noProgressWarning || !v.levelValid) return Alarm::Warning;
  return Alarm::None;
}

// Short text for the OLED status line. Emergencies are always spelled out.
const char* statusText(const View& v) {
  if (v.faults & ag::kFaultEStop) return "EMERGENCY STOP";
  if (v.faults & ag::kFaultFloat) return "HIGH LVL/FLOAT LOOP";
  if (v.faults & ag::kFaultSystem) return "K1 SYSTEM FAULT";
  if (v.faults & ag::kFaultSensor) return "SENSOR FAULT";
  if (v.faults & ag::kFaultFillTimeout) return "FILL TIMEOUT";
  if (v.faults & ag::kFaultNoProgress) return "NO LEVEL RISE";
  if (v.faults & ag::kFaultConfig) return "CONFIG FAULT";
  if (!v.commissioned) return "NOT COMMISSIONED";
  if (!v.armed) return "DISARMED - PRESS ACK";
  if (!v.levelValid) return "SENSOR STALE";
  if (v.valveOpen) return "FILLING (commanded)";
  if (v.noProgressWarning) return "NO PROGRESS WARN";
  return "MONITORING";
}

void drawOled(const View& v) {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print(v.tankName);
  oled.setCursor(128 - 6 * static_cast<int>(strlen(ag::modeName(v.mode))), 0);
  oled.print(ag::modeName(v.mode));

  oled.setTextSize(3);
  oled.setCursor(0, 14);
  if (v.hasLevel && v.levelValid) {
    oled.printf("%3d%%", static_cast<int>(v.percent + 0.5f));
  } else {
    oled.print(" --%");  // never show a stale number as the current level
  }
  oled.setTextSize(1);
  oled.setCursor(84, 14);
  if (v.hasLevel && v.levelValid) oled.printf("~%dL", static_cast<int>(v.litres + 0.5f));
  oled.setCursor(84, 26);
  oled.print(v.valveOpen ? "V:OPEN" : "V:SHUT");

  oled.setCursor(0, 42);
  oled.print(statusText(v));

  oled.setCursor(0, 54);
  if (app::setupApActive) {
    oled.print("AP pw:");
    oled.print(app::net.apPassword);
  } else if (WiFi.status() == WL_CONNECTED) {
    oled.print(WiFi.localIP());
  } else {
    oled.print("Wi-Fi offline");
  }
  oled.display();
}

uint32_t scale(uint8_t r, uint8_t g, uint8_t b, uint8_t percent) {
  return strip.Color(r * percent / 100, g * percent / 100, b * percent / 100);
}

void drawLeds(const View& v, uint32_t now) {
  const Alarm alarm = alarmOf(v);
  const bool flash = (now / 400) % 2 == 0;
  // Emergency and fault indication ignore the brightness setting.
  const uint8_t alarmBrightness = v.brightness < 50 ? 50 : v.brightness;
  strip.clear();

  if (alarm == Alarm::Emergency) {
    // Flashing red.
    if (flash) strip.fill(scale(255, 0, 0, alarmBrightness));
  } else if (alarm == Alarm::Fault) {
    // Alternating orange / red.
    strip.fill(flash ? scale(255, 90, 0, alarmBrightness) : scale(255, 0, 0, alarmBrightness));
  } else {
    uint32_t colour;
    if (alarm == Alarm::Warning || !v.armed) colour = scale(255, 90, 0, v.brightness);  // orange
    else if (v.valveOpen) colour = scale(0, 200, 255, v.brightness);                     // cyan filling
    else if (v.percent >= v.stopPct) colour = scale(0, 255, 0, v.brightness);            // green full
    else if (v.percent <= v.startPct) colour = scale(255, 200, 0, v.brightness);         // yellow low
    else colour = scale(0, 0, 255, v.brightness);                                        // blue monitoring

    // Bar graph of the level; an unknown level lights a single pixel.
    uint8_t lit = 1;
    if (v.hasLevel && v.levelValid) {
      lit = static_cast<uint8_t>((v.percent * WS2812_PIXELS + 99.0f) / 100.0f);
      if (lit < 1) lit = 1;
      if (lit > WS2812_PIXELS) lit = WS2812_PIXELS;
    }
    for (uint8_t i = 0; i < lit; i++) strip.setPixelColor(i, colour);
    // Lowest priority: magenta on the last pixel while Wi-Fi is down.
    if (WiFi.status() != WL_CONNECTED && flash) {
      strip.setPixelColor(WS2812_PIXELS - 1, scale(255, 0, 255, v.brightness));
    }
  }
  strip.show();
}

void driveBuzzer(const View& v, uint32_t now) {
  bool on = false;
  if (v.buzzerEnabled && !v.muted) {
    switch (alarmOf(v)) {
      case Alarm::Emergency: on = (now % 500) < 250; break;   // rapid
      case Alarm::Fault: on = (now % 2000) < 200; break;      // every 2 s
      case Alarm::Warning: on = (now % 10000) < 150; break;   // every 10 s
      case Alarm::None: break;
    }
  }
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
}

// ACK button: a press acknowledges locally and mutes the buzzer.
void pollButton(uint32_t now) {
  static bool pressed = false;
  static uint32_t changedAt = 0;
  const bool raw = digitalRead(PIN_ACK_BUTTON) == LOW;
  if (raw != pressed && now - changedAt > 40) {
    pressed = raw;
    changedAt = now;
    if (pressed) {
      app::cmdMute(app::Source::Local);
      app::cmdAck(app::Source::Local);
    }
  }
}
}  // namespace

void begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_ACK_BUTTON, INPUT_PULLUP);

  strip.begin();
  strip.clear();
  strip.show();

  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(50);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS);
  if (oledOk) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(2);
    oled.setCursor(0, 8);
    oled.print("AquaGuard");
    oled.setTextSize(1);
    oled.setCursor(0, 36);
    oled.print("Firmware " AQUAGUARD_FW_VERSION);
    oled.setCursor(0, 50);
    oled.print("Valve closed. Starting");
    oled.display();
  }
}

bool ackHeldAtBoot() {
  pinMode(PIN_ACK_BUTTON, INPUT_PULLUP);
  delay(5);
  return digitalRead(PIN_ACK_BUTTON) == LOW;
}

void loop() {
  static uint32_t lastFast = 0, lastOled = 0;
  const uint32_t now = millis();
  pollButton(now);
  if (now - lastFast < 50) return;
  lastFast = now;

  const View v = snapshot();
  driveBuzzer(v, now);
  drawLeds(v, now);
  if (now - lastOled >= 1000) {
    lastOled = now;
    drawOled(v);
  }
}

}  // namespace ui
