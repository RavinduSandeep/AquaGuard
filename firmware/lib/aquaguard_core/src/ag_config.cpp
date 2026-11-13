#include "ag_config.h"

#include <math.h>

namespace ag {

namespace {
bool finite(float v) { return !isnan(v) && !isinf(v); }
}  // namespace

const char* validateConfig(const Config& c) {
  if (c.tankName[0] == '\0') return "TANK_NAME_EMPTY";

  if (!finite(c.fullDistanceCm) || !finite(c.emptyDistanceCm) ||
      !finite(c.validDistanceMinCm) || !finite(c.validDistanceMaxCm) ||
      !finite(c.usableCapacityLitres) || !finite(c.startFillPercent) ||
      !finite(c.stopFillPercent) || !finite(c.highHighPercent) ||
      !finite(c.maxChangePercentPerSecond) || !finite(c.minRisePercent)) {
    return "NOT_A_NUMBER";
  }

  // The V3 probe has a blind region near 21 cm; never accept less than 25 cm.
  if (c.validDistanceMinCm < 25.0f) return "VALID_MIN_BELOW_BLIND_ZONE";
  if (c.validDistanceMaxCm > 600.0f) return "VALID_MAX_ABOVE_SENSOR_RANGE";
  if (c.validDistanceMinCm >= c.validDistanceMaxCm) return "VALID_RANGE_INVERTED";

  if (c.emptyDistanceCm < c.fullDistanceCm + 10.0f) return "EMPTY_NOT_ABOVE_FULL";
  if (c.fullDistanceCm < c.validDistanceMinCm) return "FULL_INSIDE_BLIND_ZONE";
  if (c.emptyDistanceCm > c.validDistanceMaxCm) return "EMPTY_BEYOND_VALID_RANGE";

  if (c.usableCapacityLitres <= 0.0f || c.usableCapacityLitres > 100000.0f) return "CAPACITY_RANGE";

  if (c.startFillPercent < 0.0f) return "START_BELOW_ZERO";
  if (c.startFillPercent >= c.stopFillPercent) return "START_NOT_BELOW_STOP";
  if (c.stopFillPercent >= c.highHighPercent) return "STOP_NOT_BELOW_HIGH_HIGH";
  if (c.highHighPercent > 100.0f) return "HIGH_HIGH_ABOVE_100";

  if (c.medianSamples < 3 || c.medianSamples > 15 || (c.medianSamples % 2) == 0) return "MEDIAN_SAMPLES";
  if (c.maxChangePercentPerSecond <= 0.0f || c.maxChangePercentPerSecond > 20.0f) return "MAX_CHANGE_RATE";
  if (c.validationIntervalMs < 200 || c.validationIntervalMs > 2000) return "VALIDATION_INTERVAL";
  if (c.staleTimeoutMs < 1000 || c.staleTimeoutMs > 10000) return "STALE_TIMEOUT";
  if (c.staleTimeoutMs < 2u * c.validationIntervalMs) return "STALE_SHORTER_THAN_TWO_INTERVALS";
  if (c.warningCount < 1 || c.warningCount >= c.faultCount) return "WARNING_FAULT_COUNTS";
  if (c.faultCount > 60) return "FAULT_COUNT";

  if (c.maximumFillMinutes < 1 || c.maximumFillMinutes > 120) return "MAX_FILL_MINUTES";
  if (c.progressWindowMinutes < 1 || c.progressWindowMinutes > 60) return "PROGRESS_WINDOW";
  if (c.minRisePercent <= 0.0f || c.minRisePercent > 20.0f) return "MIN_RISE";
  if (c.noProgressStopMinutes < c.progressWindowMinutes || c.noProgressStopMinutes > 120) return "NO_PROGRESS_STOP";
  if (c.retryMinutes < 5 || c.retryMinutes > 720) return "RETRY_MINUTES";

  if (c.floatClearDelaySeconds < 30 || c.floatClearDelaySeconds > 600) return "FLOAT_CLEAR_DELAY";
  if (c.maintenanceMinutes < 1 || c.maintenanceMinutes > 30) return "MAINTENANCE_MINUTES";
  if (c.manualOpenMinutes < 1 || c.manualOpenMinutes > 15) return "MANUAL_OPEN_MINUTES";
  if (c.manualOpenMinutes > c.maximumFillMinutes) return "MANUAL_OPEN_ABOVE_MAX_FILL";

  if (c.ledBrightnessPercent < 1 || c.ledBrightnessPercent > 100) return "LED_BRIGHTNESS";
  return nullptr;
}

float levelPercent(float distanceCm, float fullCm, float emptyCm) {
  const float span = emptyCm - fullCm;
  if (span <= 0.0f) return 0.0f;
  float p = 100.0f * (emptyCm - distanceCm) / span;
  if (p < 0.0f) p = 0.0f;
  if (p > 100.0f) p = 100.0f;
  return p;
}

float estimatedLitres(float percent, float usableCapacityLitres) {
  return usableCapacityLitres * percent / 100.0f;
}

}  // namespace ag
