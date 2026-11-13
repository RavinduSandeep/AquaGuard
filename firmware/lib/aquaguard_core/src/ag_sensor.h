// AquaGuard core - JSN-SR04T V3 automatic UART parser and measurement pipeline.
// Sequence (guide section 12): frame/checksum validation -> physical range
// validation -> rolling median -> rate check -> trusted level.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "ag_config.h"

namespace ag {

// Frame: 0xFF, distance high byte, distance low byte, low 8 bits of the sum of
// the first three bytes. Distance is in millimetres. FF 07 A1 A7 = 1953 mm.
class JsnParser {
 public:
  // Feed one received byte. Returns true when a checksum-valid frame completed;
  // read it with distanceMm().
  bool feed(uint8_t b);
  uint16_t distanceMm() const { return distanceMm_; }

  uint32_t frames() const { return frames_; }
  uint32_t checksumFailures() const { return checksumFailures_; }
  uint32_t garbageBytes() const { return garbageBytes_; }
  const uint8_t* lastRaw() const { return lastRaw_; }  // last 4 bytes examined

 private:
  uint8_t buf_[4] = {0, 0, 0, 0};
  uint8_t len_ = 0;
  uint8_t lastRaw_[4] = {0, 0, 0, 0};
  uint16_t distanceMm_ = 0;
  uint32_t frames_ = 0;
  uint32_t checksumFailures_ = 0;
  uint32_t garbageBytes_ = 0;
};

// Fixed-capacity rolling median over the most recent N samples.
class MedianFilter {
 public:
  static constexpr size_t kMax = 21;
  explicit MedianFilter(size_t size = 7) { resize(size); }
  void resize(size_t size);
  void clear();
  void add(uint16_t v);
  bool full() const { return count_ == size_; }
  size_t size() const { return size_; }
  size_t count() const { return count_; }
  uint16_t median() const;
  uint16_t spread() const;  // max - min of the stored samples

 private:
  uint16_t ring_[kMax] = {};
  size_t size_ = 7;
  size_t count_ = 0;
  size_t head_ = 0;
};

struct PipelineStats {
  uint32_t validOpportunities = 0;
  uint32_t invalidOpportunities = 0;
  uint32_t rangeRejects = 0;
  uint32_t jumpRejects = 0;
  uint32_t rebaselines = 0;
};

class LevelPipeline {
 public:
  // Number of consecutive mutually consistent out-of-rate readings required
  // before a new baseline is accepted.
  static constexpr uint8_t kRebaselineCount = 6;
  static constexpr float kRebaselineBandPercent = 2.0f;
  static constexpr float kRateTolerancePercent = 0.5f;
  static constexpr size_t kCalibrationSamples = 21;

  void configure(const Config& c);  // applies settings and discards all history
  void reset();

  // Call for every checksum-valid frame.
  void onFrame(uint16_t distanceMm);
  // Call once per validation interval. One call is one measurement opportunity.
  void validate(uint32_t nowMs);

  bool hasTrusted() const { return hasTrusted_; }
  float trustedPercent() const { return trustedPercent_; }
  float trustedDistanceCm() const { return trustedDistanceCm_; }
  uint32_t ageMs(uint32_t nowMs) const { return hasTrusted_ ? nowMs - trustedAtMs_ : UINT32_MAX; }
  // True when there is no trusted level or it is older than the stale timeout.
  bool isStale(uint32_t nowMs) const;

  bool warning() const { return invalidStreak_ >= cfg_.warningCount; }
  bool critical() const { return invalidStreak_ >= cfg_.faultCount; }
  uint16_t invalidStreak() const { return invalidStreak_; }

  uint16_t lastRawMm() const { return lastRawMm_; }
  uint16_t medianMm() const { return median_.full() ? median_.median() : 0; }
  size_t windowCount() const { return median_.count(); }
  const PipelineStats& stats() const { return stats_; }

  // Calibration capture: median of the last 21 in-range readings. Fails when
  // the window is not full, not fresh, or not settled (spread above 20 mm).
  bool calibrationMedianCm(float* outCm) const;

 private:
  void accept(float percent, float cm, uint32_t nowMs);

  Config cfg_;
  MedianFilter median_{7};
  MedianFilter calibration_{kCalibrationSamples};
  bool freshInWindow_ = false;
  uint16_t lastRawMm_ = 0;

  bool hasTrusted_ = false;
  float trustedPercent_ = 0.0f;
  float trustedDistanceCm_ = 0.0f;
  uint32_t trustedAtMs_ = 0;

  uint16_t invalidStreak_ = 0;
  uint8_t jumpStreak_ = 0;
  float jumpCandidatePercent_ = 0.0f;
  PipelineStats stats_;
};

}  // namespace ag
