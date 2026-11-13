// AquaGuard core - tunable configuration and its validation.
// Pure C++ (no Arduino dependency) so it is covered by the native unit tests.
// Defaults follow section 13 of the project guide.
#pragma once
#include <stdint.h>

namespace ag {

constexpr uint16_t kConfigSchema = 1;

struct Config {
  char tankName[24] = "Tank";

  // Calibration. Example values only until `commissioned` is set on site.
  float fullDistanceCm = 35.0f;
  float emptyDistanceCm = 145.0f;
  float usableCapacityLitres = 1000.0f;
  bool commissioned = false;  // arming is refused until calibration is confirmed

  // Control thresholds: 0 <= start < stop < highHigh <= 100
  float startFillPercent = 35.0f;
  float stopFillPercent = 90.0f;
  float highHighPercent = 95.0f;

  // Measurement validation
  float validDistanceMinCm = 30.0f;
  float validDistanceMaxCm = 600.0f;
  uint8_t medianSamples = 7;  // odd, 3..15
  float maxChangePercentPerSecond = 1.0f;
  uint16_t validationIntervalMs = 500;
  uint16_t staleTimeoutMs = 2000;
  uint8_t warningCount = 3;
  uint8_t faultCount = 10;

  // Fill supervision
  uint16_t maximumFillMinutes = 120;
  uint16_t progressWindowMinutes = 10;
  float minRisePercent = 1.0f;
  uint16_t noProgressStopMinutes = 20;
  bool autoRetry = false;
  uint16_t retryMinutes = 30;

  // Operator timing
  uint16_t floatClearDelaySeconds = 30;
  uint16_t maintenanceMinutes = 10;
  uint16_t manualOpenMinutes = 5;

  // Indication
  uint8_t ledBrightnessPercent = 20;
  bool buzzerEnabled = true;
};

// Returns nullptr when the configuration is valid, otherwise a short
// machine-readable reason naming the first rule that failed.
const char* validateConfig(const Config& c);

// level_percent = 100 * (empty - distance) / (empty - full), clamped 0..100
float levelPercent(float distanceCm, float fullCm, float emptyCm);
float estimatedLitres(float percent, float usableCapacityLitres);

}  // namespace ag
