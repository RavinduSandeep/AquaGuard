// Safety/control task: debounced inputs, sensor UART, measurement validation
// and the SafetyManager tick, about every 20 ms. It is the only code that
// writes the valve GPIO. Nothing in this task waits on the network, display
// or flash.
#include "control.h"

#include <driver/gpio.h>
#include <esp_task_wdt.h>

#include "app.h"
#include "pins.h"

namespace control {

namespace {
constexpr uint32_t kTickMs = 20;
constexpr uint8_t kDebounceTicks = 2;  // 2 x 20 ms: stable for at least 20 ms

// LOW = healthy for all three monitored inputs; a broken wire reads HIGH.
struct Debounced {
  uint8_t pin;
  bool healthy = false;
  uint8_t count = 0;
  void begin() {
    pinMode(pin, INPUT);  // external 10k pull-up + RC filter on the board
    healthy = digitalRead(pin) == LOW;
  }
  void update() {
    const bool raw = digitalRead(pin) == LOW;
    if (raw == healthy) {
      count = 0;
    } else if (++count >= kDebounceTicks) {
      healthy = raw;
      count = 0;
    }
  }
};

Debounced floatIn{PIN_FLOAT_OK};
Debounced estopIn{PIN_ESTOP_OK};
Debounced k1In{PIN_K1_FEEDBACK};

void task(void*) {
  esp_task_wdt_add(nullptr);
  TickType_t last = xTaskGetTickCount();
  uint32_t lastValidate = millis();

  for (;;) {
    vTaskDelayUntil(&last, pdMS_TO_TICKS(kTickMs));
    const uint32_t now = millis();
    floatIn.update();
    estopIn.update();
    k1In.update();

    bool open;
    {
      app::Lock l;
      int budget = 256;  // bounded work per tick even under a byte flood
      while (budget-- > 0 && Serial1.available() > 0) {
        if (app::parser.feed(static_cast<uint8_t>(Serial1.read()))) {
          app::pipeline.onFrame(app::parser.distanceMm());
        }
      }
      if (now - lastValidate >= app::cfg.validationIntervalMs) {
        lastValidate = now;
        app::pipeline.validate(now);
      }

      ag::SafetyInputs in;
      in.floatHealthy = floatIn.healthy;
      in.estopHealthy = estopIn.healthy;
      in.k1Enabled = k1In.healthy;
      in.levelValid = !app::pipeline.isStale(now);
      in.levelPercent = app::pipeline.hasTrusted() ? app::pipeline.trustedPercent() : 0.0f;
      in.sensorCritical = app::pipeline.critical();
      app::inputs = in;
      app::safety.tick(now, in);
      open = app::safety.valveRequest();
    }
    digitalWrite(PIN_VALVE, open ? VALVE_ON_LEVEL : VALVE_OFF_LEVEL);
    esp_task_wdt_reset();
  }
}
}  // namespace

void holdValveClosed() {
  // Drive the off level into the output latch before enabling the driver so
  // the pin never glitches open. The 47k pulldown covers the time before this.
  gpio_set_level(static_cast<gpio_num_t>(PIN_VALVE), VALVE_OFF_LEVEL);
  pinMode(PIN_VALVE, OUTPUT);
  digitalWrite(PIN_VALVE, VALVE_OFF_LEVEL);
}

void begin() {
  floatIn.begin();
  estopIn.begin();
  k1In.begin();
  Serial1.setRxBufferSize(512);
  Serial1.begin(SENSOR_BAUD, SERIAL_8N1, PIN_SENSOR_RX, PIN_SENSOR_TX);

  // If the control task ever stops ticking for 3 s the chip resets; the valve
  // request then falls LOW and the unit boots disarmed.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const esp_task_wdt_config_t wdt = {.timeout_ms = 3000, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
#else
  esp_task_wdt_init(3, true);
#endif
  xTaskCreatePinnedToCore(task, "ag-control", 6144, nullptr, configMAX_PRIORITIES - 3, nullptr, 1);
}

}  // namespace control
