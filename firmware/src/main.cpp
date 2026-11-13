// AquaGuard firmware - ESP32-S3 DevKitC-1 N16R8
// Smart residential water tank monitoring and automatic filling.
//
// Boot order (guide section 14): hold the valve request LOW, load and validate
// the configuration, initialise safety inputs, start the sensor UART, then
// stay DISARMED until an acknowledgement with every check healthy.
#include <Arduino.h>

#include "app.h"
#include "cloud.h"
#include "control.h"
#include "storage.h"
#include "ui.h"
#include "version.h"
#include "webapi.h"

void setup() {
  control::holdValveClosed();  // before anything that can block or fail

  Serial.begin(115200);
  Serial.printf("\nAquaGuard firmware %s (data schema %d)\n", AQUAGUARD_FW_VERSION, AQUAGUARD_DATA_SCHEMA);
  Serial.printf("Flash %u MB, PSRAM %u KB, reset reason %d\n",
                static_cast<unsigned>(ESP.getFlashChipSize() >> 20),
                static_cast<unsigned>(ESP.getPsramSize() >> 10), static_cast<int>(esp_reset_reason()));

  app::begin();
  if (!app::cfgValid) Serial.printf("Stored settings rejected: %s. Staying disarmed.\n", app::cfgError);
  Serial.printf("Device ID %s\n", app::net.deviceId.c_str());

  const bool forceSetupAp = ui::ackHeldAtBoot();
  ui::begin();
  control::begin();
  webapi::begin(forceSetupAp);
  cloud::begin();
}

void loop() {
  ui::loop();
  webapi::loop();

  // Remember the latches that must survive a power cycle. Done here so flash
  // writes never run inside the control task.
  static uint16_t stored = storage::loadFaults() & ag::kPersistentFaults;
  uint16_t faults;
  {
    app::Lock l;
    faults = app::safety.faults() & ag::kPersistentFaults;
  }
  if (faults != stored) {
    storage::saveFaults(faults);
    stored = faults;
  }
  delay(5);
}
