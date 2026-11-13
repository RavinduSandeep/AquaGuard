// Persistent storage in NVS (Preferences): versioned settings with a CRC,
// network settings, and the fault latches that must survive a reboot.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "ag_config.h"
#include "app.h"

namespace storage {

// JSON <-> Config. fromJson only changes keys that are present. When
// `remote` is true the calibration fields are refused (local-only).
void configToJson(const ag::Config& c, JsonObject out);
const char* configFromJson(JsonObjectConst in, ag::Config& c, bool remote);

// Returns false (and leaves defaults in `c`) when the stored blob is corrupt.
// A unit that has never been configured loads defaults and returns true.
bool loadConfig(ag::Config& c, const char** error);
bool saveConfig(const ag::Config& c);

void loadNet(NetSettings& n);
void saveNet(const NetSettings& n);

uint16_t loadFaults();
void saveFaults(uint16_t faults);

// Admin password helpers.
String randomHex(size_t bytes);
String hashPassword(const String& salt, const String& password);
bool constantTimeEquals(const String& a, const String& b);

}  // namespace storage
