#include "ag_sensor.h"

#include <math.h>
#include <string.h>

namespace ag {

// ---------------------------------------------------------------- JsnParser

bool JsnParser::feed(uint8_t b) {
  if (len_ == 0 && b != 0xFF) {
    garbageBytes_++;
    return false;
  }
  buf_[len_++] = b;
  if (len_ < 4) return false;

  memcpy(lastRaw_, buf_, 4);
  const uint8_t sum = static_cast<uint8_t>(buf_[0] + buf_[1] + buf_[2]);
  if (sum == buf_[3]) {
    distanceMm_ = static_cast<uint16_t>((buf_[1] << 8) | buf_[2]);
    frames_++;
    len_ = 0;
    return true;
  }

  // Bad checksum: drop the header and resynchronise on the next 0xFF that is
  // already in the buffer, so one corrupt byte costs at most one frame.
  checksumFailures_++;
  uint8_t start = 1;
  while (start < 4 && buf_[start] != 0xFF) start++;
  garbageBytes_ += start;
  len_ = static_cast<uint8_t>(4 - start);
  memmove(buf_, buf_ + start, len_);
  return false;
}

// -------------------------------------------------------------- MedianFilter

void MedianFilter::resize(size_t size) {
  if (size < 1) size = 1;
  if (size > kMax) size = kMax;
  size_ = size;
  clear();
}

void MedianFilter::clear() {
  count_ = 0;
  head_ = 0;
}

void MedianFilter::add(uint16_t v) {
  ring_[head_] = v;
  head_ = (head_ + 1) % size_;
  if (count_ < size_) count_++;
}

uint16_t MedianFilter::median() const {
  if (count_ == 0) return 0;
  uint16_t sorted[kMax];
  memcpy(sorted, ring_, count_ * sizeof(uint16_t));
  for (size_t i = 1; i < count_; i++) {  // insertion sort, N <= 21
    const uint16_t key = sorted[i];
    size_t j = i;
    while (j > 0 && sorted[j - 1] > key) {
      sorted[j] = sorted[j - 1];
      j--;
    }
    sorted[j] = key;
  }
  return sorted[count_ / 2];
}

uint16_t MedianFilter::spread() const {
  if (count_ == 0) return 0;
  uint16_t lo = ring_[0], hi = ring_[0];
  for (size_t i = 1; i < count_; i++) {
    if (ring_[i] < lo) lo = ring_[i];
    if (ring_[i] > hi) hi = ring_[i];
  }
  return static_cast<uint16_t>(hi - lo);
}

// ------------------------------------------------------------- LevelPipeline

void LevelPipeline::configure(const Config& c) {
  cfg_ = c;
  median_.resize(c.medianSamples);
  reset();
}

void LevelPipeline::reset() {
  median_.clear();
  calibration_.clear();
  freshInWindow_ = false;
  hasTrusted_ = false;
  invalidStreak_ = 0;
  jumpStreak_ = 0;
}

void LevelPipeline::onFrame(uint16_t distanceMm) {
  lastRawMm_ = distanceMm;
  const float cm = distanceMm / 10.0f;
  if (cm < cfg_.validDistanceMinCm || cm > cfg_.validDistanceMaxCm) {
    stats_.rangeRejects++;
    return;
  }
  median_.add(distanceMm);
  calibration_.add(distanceMm);
  freshInWindow_ = true;
}

bool LevelPipeline::isStale(uint32_t nowMs) const {
  return !hasTrusted_ || (nowMs - trustedAtMs_) >= cfg_.staleTimeoutMs;
}

void LevelPipeline::accept(float percent, float cm, uint32_t nowMs) {
  hasTrusted_ = true;
  trustedPercent_ = percent;
  trustedDistanceCm_ = cm;
  trustedAtMs_ = nowMs;
  invalidStreak_ = 0;
  jumpStreak_ = 0;
  stats_.validOpportunities++;
}

void LevelPipeline::validate(uint32_t nowMs) {
  const bool fresh = freshInWindow_;
  freshInWindow_ = false;

  if (!fresh || !median_.full()) {
    // No new in-range data this interval, or the window is still filling
    // after a reset. A frozen or disconnected sensor lands here.
    if (invalidStreak_ < UINT16_MAX) invalidStreak_++;
    stats_.invalidOpportunities++;
    if (!fresh) calibration_.clear();
    return;
  }

  const float cm = median_.median() / 10.0f;
  const float pct = levelPercent(cm, cfg_.fullDistanceCm, cfg_.emptyDistanceCm);

  if (!hasTrusted_) {
    accept(pct, cm, nowMs);
    return;
  }

  const float dtS = (nowMs - trustedAtMs_) / 1000.0f;
  const float allowed = cfg_.maxChangePercentPerSecond * dtS + kRateTolerancePercent;
  if (fabsf(pct - trustedPercent_) <= allowed) {
    accept(pct, cm, nowMs);
    return;
  }

  // Sudden jump: do not refresh the trusted timestamp. Accept a new baseline
  // only after several mutually consistent readings.
  stats_.jumpRejects++;
  stats_.invalidOpportunities++;
  if (invalidStreak_ < UINT16_MAX) invalidStreak_++;
  if (jumpStreak_ > 0 && fabsf(pct - jumpCandidatePercent_) <= kRebaselineBandPercent) {
    jumpStreak_++;
  } else {
    jumpStreak_ = 1;
  }
  jumpCandidatePercent_ = pct;
  if (jumpStreak_ >= kRebaselineCount) {
    stats_.rebaselines++;
    stats_.invalidOpportunities--;  // this opportunity ends up accepted
    accept(pct, cm, nowMs);
  }
}

bool LevelPipeline::calibrationMedianCm(float* outCm) const {
  if (!calibration_.full()) return false;
  if (calibration_.spread() > 20) return false;
  if (outCm) *outCm = calibration_.median() / 10.0f;
  return true;
}

}  // namespace ag
