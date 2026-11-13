// Native unit tests for the hardware-independent core.
// Run with:  pio test -e native
#include <unity.h>

#include <vector>

#include "ag_config.h"
#include "ag_safety.h"
#include "ag_sensor.h"

using namespace ag;

void setUp() {}
void tearDown() {}

// ------------------------------------------------------------------ helpers

static void feedFrame(JsnParser& p, LevelPipeline& pipe, uint16_t mm) {
  const uint8_t hi = mm >> 8, lo = mm & 0xFF;
  const uint8_t f[4] = {0xFF, hi, lo, static_cast<uint8_t>(0xFF + hi + lo)};
  for (uint8_t b : f) {
    if (p.feed(b)) pipe.onFrame(p.distanceMm());
  }
}

static Config commissionedConfig() {
  Config c;  // full 35 cm, empty 145 cm
  c.commissioned = true;
  return c;
}

static uint16_t mmForPercent(const Config& c, float pct) {
  const float cm = c.emptyDistanceCm - pct / 100.0f * (c.emptyDistanceCm - c.fullDistanceCm);
  return static_cast<uint16_t>(cm * 10.0f + 0.5f);
}

struct Rig {
  Config cfg = commissionedConfig();
  SafetyManager sm;
  SafetyInputs in;
  uint32_t now = 1000;
  std::vector<Event> events;

  static void sink(void* ctx, Event e, int32_t) { static_cast<Rig*>(ctx)->events.push_back(e); }

  explicit Rig(uint16_t restored = 0, bool valid = true) {
    in.floatHealthy = in.estopHealthy = in.k1Enabled = true;
    in.levelValid = true;
    in.levelPercent = 60.0f;
    sm.setEventSink(&Rig::sink, this);
    sm.begin(cfg, valid, restored, now);
  }
  void run(uint32_t ms) {
    const uint32_t end = now + ms;
    while (now < end) {
      now += 20;
      sm.tick(now, in);
    }
  }
  void runMinutes(uint32_t m) {  // coarse steps keep long tests fast
    const uint32_t end = now + m * 60000UL;
    while (now < end) {
      now += 1000;
      sm.tick(now, in);
    }
  }
  void arm() {
    run(40);
    TEST_ASSERT_EQUAL(static_cast<int>(Deny::None), static_cast<int>(sm.acknowledge(now, true)));
    TEST_ASSERT_TRUE(sm.armed());
  }
  bool saw(Event e) const {
    for (Event x : events) if (x == e) return true;
    return false;
  }
};

#define ASSERT_DENY(expected, actual) \
  TEST_ASSERT_EQUAL_STRING(denyName(expected), denyName(actual))

// ------------------------------------------------------------------- parser

void test_parser_decodes_guide_example_frame() {
  JsnParser p;
  TEST_ASSERT_FALSE(p.feed(0xFF));
  TEST_ASSERT_FALSE(p.feed(0x07));
  TEST_ASSERT_FALSE(p.feed(0xA1));
  TEST_ASSERT_TRUE(p.feed(0xA7));
  TEST_ASSERT_EQUAL_UINT16(1953, p.distanceMm());
  TEST_ASSERT_EQUAL_UINT32(1, p.frames());
}

void test_parser_rejects_bad_checksum() {
  JsnParser p;
  const uint8_t bad[4] = {0xFF, 0x07, 0xA1, 0xA8};
  for (uint8_t b : bad) TEST_ASSERT_FALSE(p.feed(b));
  TEST_ASSERT_EQUAL_UINT32(0, p.frames());
  TEST_ASSERT_EQUAL_UINT32(1, p.checksumFailures());
}

void test_parser_resynchronises_after_garbage() {
  JsnParser p;
  const uint8_t stream[] = {0x12, 0x00, 0x34, 0xFF, 0x07, 0xA1, 0xA7, 0x55, 0xFF, 0x03, 0xE8, 0xEA};
  int frames = 0;
  uint16_t last = 0;
  for (uint8_t b : stream) {
    if (p.feed(b)) {
      frames++;
      last = p.distanceMm();
    }
  }
  TEST_ASSERT_EQUAL(2, frames);
  TEST_ASSERT_EQUAL_UINT16(1000, last);
  TEST_ASSERT_EQUAL_UINT32(0, p.checksumFailures());
}

void test_parser_recovers_when_a_byte_is_lost() {
  JsnParser p;
  // First frame loses its checksum byte, so the next header is swallowed.
  const uint8_t stream[] = {0xFF, 0x07, 0xA1, 0xFF, 0x07, 0xA1, 0xA7, 0xFF, 0x07, 0xA1, 0xA7};
  int frames = 0;
  for (uint8_t b : stream) frames += p.feed(b) ? 1 : 0;
  TEST_ASSERT_EQUAL(2, frames);
  TEST_ASSERT_EQUAL_UINT32(1, p.checksumFailures());
}

void test_parser_survives_long_garbage_without_growth() {
  JsnParser p;
  for (int i = 0; i < 10000; i++) p.feed(static_cast<uint8_t>(i * 7));
  const uint8_t ok[4] = {0xFF, 0x07, 0xA1, 0xA7};
  bool got = false;
  for (int rep = 0; rep < 3 && !got; rep++)
    for (uint8_t b : ok) got = p.feed(b) || got;
  TEST_ASSERT_TRUE(got);
}

// ------------------------------------------------------------- level maths

void test_level_percent_guide_example() {
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 75.0f, levelPercent(62.5f, 35.0f, 145.0f));
  TEST_ASSERT_FLOAT_WITHIN(0.1f, 750.0f, estimatedLitres(75.0f, 1000.0f));
}

void test_level_percent_clamps() {
  TEST_ASSERT_EQUAL_FLOAT(100.0f, levelPercent(20.0f, 35.0f, 145.0f));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, levelPercent(200.0f, 35.0f, 145.0f));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, levelPercent(50.0f, 100.0f, 100.0f));
}

void test_median_filter() {
  MedianFilter m(7);
  const uint16_t v[] = {100, 5000, 101, 99, 0, 102, 100};
  for (uint16_t x : v) m.add(x);
  TEST_ASSERT_TRUE(m.full());
  TEST_ASSERT_EQUAL_UINT16(100, m.median());
  m.add(103);  // replaces the oldest (100)
  TEST_ASSERT_EQUAL_UINT16(101, m.median());
}

// ------------------------------------------------------------------ config

void test_default_config_is_valid() {
  Config c;
  TEST_ASSERT_NULL(validateConfig(c));
}

void test_config_rejects_bad_values() {
  Config c;
  c.emptyDistanceCm = 30.0f;
  TEST_ASSERT_EQUAL_STRING("EMPTY_NOT_ABOVE_FULL", validateConfig(c));
  c = Config();
  c.fullDistanceCm = 15.0f;  // the brief's 15 cm example is inside the blind zone
  TEST_ASSERT_EQUAL_STRING("FULL_INSIDE_BLIND_ZONE", validateConfig(c));
  c = Config();
  c.startFillPercent = 95.0f;
  TEST_ASSERT_EQUAL_STRING("START_NOT_BELOW_STOP", validateConfig(c));
  c = Config();
  c.stopFillPercent = 96.0f;
  TEST_ASSERT_EQUAL_STRING("STOP_NOT_BELOW_HIGH_HIGH", validateConfig(c));
  c = Config();
  c.medianSamples = 8;
  TEST_ASSERT_EQUAL_STRING("MEDIAN_SAMPLES", validateConfig(c));
  c = Config();
  c.maximumFillMinutes = 500;
  TEST_ASSERT_EQUAL_STRING("MAX_FILL_MINUTES", validateConfig(c));
  c = Config();
  c.fullDistanceCm = 0.0f / 0.0f;
  TEST_ASSERT_EQUAL_STRING("NOT_A_NUMBER", validateConfig(c));
}

// ---------------------------------------------------------------- pipeline

struct PipeRig {
  Config cfg = commissionedConfig();
  JsnParser parser;
  LevelPipeline pipe;
  uint32_t now = 0;
  PipeRig() { pipe.configure(cfg); }
  // One 500 ms validation interval with five frames at the given distance.
  void interval(uint16_t mm, int frames = 5) {
    for (int i = 0; i < frames; i++) feedFrame(parser, pipe, mm);
    now += cfg.validationIntervalMs;
    pipe.validate(now);
  }
  void silent() {
    now += cfg.validationIntervalMs;
    pipe.validate(now);
  }
};

void test_pipeline_needs_full_window_before_trusting() {
  PipeRig r;
  r.interval(900, 5);
  TEST_ASSERT_FALSE(r.pipe.hasTrusted());  // 5 of 7 samples
  r.interval(900, 5);
  TEST_ASSERT_TRUE(r.pipe.hasTrusted());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, r.pipe.trustedPercent());
  TEST_ASSERT_FALSE(r.pipe.isStale(r.now));
}

void test_pipeline_rejects_out_of_range_and_zero() {
  PipeRig r;
  r.interval(0);
  r.interval(100);    // 10 cm, inside the blind zone
  r.interval(6500);   // beyond 600 cm
  TEST_ASSERT_FALSE(r.pipe.hasTrusted());
  TEST_ASSERT_TRUE(r.pipe.isStale(r.now));  // missing data is never "empty"
  TEST_ASSERT_EQUAL_UINT32(15, r.pipe.stats().rangeRejects);
}

void test_pipeline_goes_stale_after_two_seconds_of_silence() {
  PipeRig r;
  r.interval(900); r.interval(900);
  r.silent(); r.silent(); r.silent();
  TEST_ASSERT_FALSE(r.pipe.isStale(r.now));  // 1.5 s old
  TEST_ASSERT_TRUE(r.pipe.warning());        // 3 invalid opportunities
  r.silent();
  TEST_ASSERT_TRUE(r.pipe.isStale(r.now));   // 2.0 s old
  TEST_ASSERT_FALSE(r.pipe.critical());
  for (int i = 0; i < 6; i++) r.silent();
  TEST_ASSERT_TRUE(r.pipe.critical());       // 10 invalid opportunities
}

void test_pipeline_rejects_sudden_jump_without_refreshing_timestamp() {
  PipeRig r;
  r.interval(900); r.interval(900);
  const uint32_t trustedAt = r.now;
  const uint16_t jump = mmForPercent(r.cfg, 90.0f);
  r.interval(jump, 7);  // whole window replaced at once
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, r.pipe.trustedPercent());
  TEST_ASSERT_EQUAL_UINT32(500, r.pipe.ageMs(r.now));
  TEST_ASSERT_EQUAL_UINT32(trustedAt, r.now - r.pipe.ageMs(r.now));
  TEST_ASSERT_EQUAL_UINT32(1, r.pipe.stats().jumpRejects);
}

void test_pipeline_persistent_jump_goes_stale_then_rebaselines() {
  PipeRig r;
  r.interval(900); r.interval(900);
  const uint16_t jump = mmForPercent(r.cfg, 90.0f);
  bool wentStale = false;
  for (int i = 0; i < LevelPipeline::kRebaselineCount; i++) {
    r.interval(jump, 7);
    if (i < LevelPipeline::kRebaselineCount - 1 && r.pipe.isStale(r.now)) wentStale = true;
  }
  TEST_ASSERT_TRUE(wentStale);  // the valve would have closed first
  TEST_ASSERT_FALSE(r.pipe.isStale(r.now));
  TEST_ASSERT_FLOAT_WITHIN(0.2f, 90.0f, r.pipe.trustedPercent());
  TEST_ASSERT_EQUAL_UINT32(1, r.pipe.stats().rebaselines);
}

void test_pipeline_single_outlier_is_absorbed_by_median() {
  PipeRig r;
  r.interval(900); r.interval(900);
  for (int i = 0; i < 4; i++) feedFrame(r.parser, r.pipe, 900);
  feedFrame(r.parser, r.pipe, 400);
  r.now += 500;
  r.pipe.validate(r.now);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, r.pipe.trustedPercent());
  TEST_ASSERT_EQUAL_UINT32(0, r.pipe.ageMs(r.now));
}

void test_pipeline_follows_a_normal_fill() {
  PipeRig r;
  float pct = 40.0f;
  r.interval(mmForPercent(r.cfg, pct)); r.interval(mmForPercent(r.cfg, pct));
  for (int i = 0; i < 100; i++) {
    pct += 0.25f;  // 0.5 %/s, inside the 1 %/s limit
    r.interval(mmForPercent(r.cfg, pct));
    TEST_ASSERT_FALSE(r.pipe.isStale(r.now));
  }
  TEST_ASSERT_FLOAT_WITHIN(1.0f, pct, r.pipe.trustedPercent());
  TEST_ASSERT_EQUAL_UINT32(0, r.pipe.stats().jumpRejects);
}

void test_pipeline_repeated_identical_readings_stay_valid() {
  PipeRig r;
  for (int i = 0; i < 200; i++) r.interval(900);
  TEST_ASSERT_FALSE(r.pipe.isStale(r.now));
  TEST_ASSERT_FALSE(r.pipe.warning());
}

void test_calibration_capture_needs_settled_window() {
  PipeRig r;
  float cm = 0;
  r.interval(1450, 5);
  TEST_ASSERT_FALSE(r.pipe.calibrationMedianCm(&cm));  // not 21 samples yet
  for (int i = 0; i < 4; i++) r.interval(1450, 5);
  TEST_ASSERT_TRUE(r.pipe.calibrationMedianCm(&cm));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 145.0f, cm);
  r.interval(1200, 5);  // target moved: spread too large
  TEST_ASSERT_FALSE(r.pipe.calibrationMedianCm(&cm));
}

// ------------------------------------------------------------------ safety

void test_boot_is_disarmed_and_closed() {
  Rig r;
  r.in.levelPercent = 10.0f;  // well below the start point
  r.run(5000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_FALSE(r.sm.armed());
  TEST_ASSERT_EQUAL_STRING("DISARMED", phaseName(r.sm.phase()));
}

void test_uncommissioned_unit_cannot_arm() {
  Rig r;
  Config c;  // commissioned = false
  r.sm.applyConfig(c, r.now);
  r.run(40);
  ASSERT_DENY(Deny::NotCommissioned, r.sm.acknowledge(r.now, true));
  TEST_ASSERT_FALSE(r.sm.armed());
}

void test_auto_fill_hysteresis() {
  Rig r;
  r.arm();
  r.in.levelPercent = 36.0f;
  r.run(200);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.in.levelPercent = 35.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.in.levelPercent = 60.0f;  // keeps filling through the middle range
  r.run(200);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.in.levelPercent = 90.0f;
  r.run(40);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.saw(Event::FillComplete));
  r.in.levelPercent = 50.0f;  // stays off until 35 again
  r.run(200);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_estop_closes_latches_and_needs_release_plus_ack() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());

  r.in.estopHealthy = false;
  r.in.k1Enabled = false;
  r.run(20);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultEStop);
  ASSERT_DENY(Deny::EStopActive, r.sm.acknowledge(r.now, true));

  r.in.estopHealthy = true;  // released: must not restart by itself
  r.in.k1Enabled = true;
  r.run(5000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultEStop);

  ASSERT_DENY(Deny::LocalAckRequired, r.sm.acknowledge(r.now, false));  // remote
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultEStop);
  ASSERT_DENY(Deny::None, r.sm.acknowledge(r.now, true));
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_float_trip_needs_thirty_healthy_seconds_and_ack() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());

  r.in.floatHealthy = false;
  r.in.k1Enabled = false;
  r.run(20);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  ASSERT_DENY(Deny::FloatLoopFault, r.sm.acknowledge(r.now, true));

  r.in.floatHealthy = true;
  r.in.k1Enabled = true;
  r.run(10000);
  ASSERT_DENY(Deny::FloatClearDelay, r.sm.acknowledge(r.now, true));
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.run(21000);
  ASSERT_DENY(Deny::None, r.sm.acknowledge(r.now, true));
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_k1_feedback_mismatch_raises_system_fault() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.in.k1Enabled = false;  // loops healthy but relay not energised
  r.run(20);
  TEST_ASSERT_FALSE(r.sm.valveRequest());  // closes at once
  r.run(600);
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultSystem);
  ASSERT_DENY(Deny::K1Disabled, r.sm.acknowledge(r.now, true));
}

void test_stale_sensor_closes_and_missing_data_never_opens() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.in.levelValid = false;
  r.run(20);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.in.levelPercent = 0.0f;  // a stale zero must not be read as an empty tank
  r.run(5000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());

  r.in.sensorCritical = true;
  r.run(20);
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultSensor);
  r.in.sensorCritical = false;
  r.in.levelValid = true;
  r.in.levelPercent = 20.0f;
  r.run(1000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());  // latched until acknowledged
  ASSERT_DENY(Deny::None, r.sm.acknowledge(r.now, true));
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_fill_timeout_latches() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  for (int m = 0; m < 119; m++) {
    r.in.levelPercent += 0.5f;  // slow but real progress
    r.runMinutes(1);
  }
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.runMinutes(2);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultFillTimeout);
  r.runMinutes(60);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_no_progress_warns_at_ten_and_closes_at_twenty_minutes() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  r.runMinutes(9);
  TEST_ASSERT_FALSE(r.sm.noProgressWarning());
  r.runMinutes(2);
  TEST_ASSERT_TRUE(r.sm.noProgressWarning());
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.runMinutes(10);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultNoProgress);
}

void test_auto_retry_waits_and_never_clears_safety_latches() {
  Rig r;
  r.cfg.autoRetry = true;
  r.sm.applyConfig(r.cfg, r.now);
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  r.runMinutes(21);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_FALSE(r.sm.faults() & kFaultNoProgress);
  TEST_ASSERT_EQUAL_STRING("RETRY_WAIT", phaseName(r.sm.phase()));
  r.runMinutes(20);
  TEST_ASSERT_FALSE(r.sm.valveRequest());

  r.in.estopHealthy = false;  // stop pressed and released during the wait
  r.in.k1Enabled = false;
  r.run(40);
  r.in.estopHealthy = true;
  r.in.k1Enabled = true;
  r.runMinutes(30);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultEStop);
}

void test_auto_retry_reopens_after_the_interval() {
  Rig r;
  r.cfg.autoRetry = true;
  r.sm.applyConfig(r.cfg, r.now);
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  r.runMinutes(21);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.runMinutes(31);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_manual_open_is_time_limited_and_protected() {
  Rig r;
  r.arm();
  ASSERT_DENY(Deny::WrongMode, r.sm.requestOpen(r.now));  // still AUTO
  ASSERT_DENY(Deny::None, r.sm.requestMode(Mode::Manual, r.now));
  r.in.levelPercent = 50.0f;
  r.run(40);
  ASSERT_DENY(Deny::None, r.sm.requestOpen(r.now));
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.runMinutes(4);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.runMinutes(2);
  TEST_ASSERT_FALSE(r.sm.valveRequest());  // 5 minute limit

  r.in.levelPercent = 91.0f;
  r.run(40);
  ASSERT_DENY(Deny::LevelHigh, r.sm.requestOpen(r.now));
  r.in.levelPercent = 50.0f;
  r.in.estopHealthy = false;
  r.in.k1Enabled = false;
  r.run(40);
  ASSERT_DENY(Deny::EStopActive, r.sm.requestOpen(r.now));
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_close_is_always_honoured_and_leaves_auto() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  ASSERT_DENY(Deny::None, r.sm.requestClose(r.now));
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.run(5000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_EQUAL_STRING("MANUAL", modeName(r.sm.mode()));
}

void test_maintenance_expires_back_to_previous_mode() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  ASSERT_DENY(Deny::None, r.sm.requestMode(Mode::Maintenance, r.now));
  r.run(1000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());  // automatic filling suspended
  r.runMinutes(11);
  TEST_ASSERT_EQUAL_STRING("AUTO", modeName(r.sm.mode()));
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_lockout_and_disarm_close_the_valve() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.sm.setLockout(true, r.now);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.run(1000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  r.sm.setLockout(false, r.now);
  r.sm.disarm(r.now);
  r.run(1000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_invalid_config_stays_closed_and_cannot_arm() {
  Rig r(0, false);
  r.in.levelPercent = 10.0f;
  r.run(1000);
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultConfig);
  ASSERT_DENY(Deny::ConfigInvalid, r.sm.acknowledge(r.now, true));
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_estop_latch_survives_a_reboot() {
  Rig r(kFaultEStop);  // restored from storage; inputs are healthy now
  r.in.levelPercent = 10.0f;
  r.run(5000);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
  TEST_ASSERT_TRUE(r.sm.faults() & kFaultEStop);
  ASSERT_DENY(Deny::LocalAckRequired, r.sm.acknowledge(r.now, false));
  ASSERT_DENY(Deny::None, r.sm.acknowledge(r.now, true));
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
}

void test_config_change_ends_a_fill() {
  Rig r;
  r.arm();
  r.in.levelPercent = 20.0f;
  r.run(40);
  TEST_ASSERT_TRUE(r.sm.valveRequest());
  r.sm.applyConfig(r.cfg, r.now);
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

void test_millis_rollover_does_not_break_timers() {
  Rig r;
  r.now = 0xFFFFFFFFu - 120000u;  // two minutes before the 49.7 day wrap
  r.sm.begin(r.cfg, true, 0, r.now);
  r.arm();
  r.sm.requestMode(Mode::Manual, r.now);
  r.in.levelPercent = 50.0f;
  r.run(40);
  ASSERT_DENY(Deny::None, r.sm.requestOpen(r.now));
  uint32_t elapsed = 0;
  while (elapsed < 4 * 60000u) { r.now += 1000; elapsed += 1000; r.sm.tick(r.now, r.in); }
  TEST_ASSERT_TRUE(r.sm.valveRequest());   // crossed the wrap, still inside 5 min
  while (elapsed < 6 * 60000u) { r.now += 1000; elapsed += 1000; r.sm.tick(r.now, r.in); }
  TEST_ASSERT_FALSE(r.sm.valveRequest());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_parser_decodes_guide_example_frame);
  RUN_TEST(test_parser_rejects_bad_checksum);
  RUN_TEST(test_parser_resynchronises_after_garbage);
  RUN_TEST(test_parser_recovers_when_a_byte_is_lost);
  RUN_TEST(test_parser_survives_long_garbage_without_growth);
  RUN_TEST(test_level_percent_guide_example);
  RUN_TEST(test_level_percent_clamps);
  RUN_TEST(test_median_filter);
  RUN_TEST(test_default_config_is_valid);
  RUN_TEST(test_config_rejects_bad_values);
  RUN_TEST(test_pipeline_needs_full_window_before_trusting);
  RUN_TEST(test_pipeline_rejects_out_of_range_and_zero);
  RUN_TEST(test_pipeline_goes_stale_after_two_seconds_of_silence);
  RUN_TEST(test_pipeline_rejects_sudden_jump_without_refreshing_timestamp);
  RUN_TEST(test_pipeline_persistent_jump_goes_stale_then_rebaselines);
  RUN_TEST(test_pipeline_single_outlier_is_absorbed_by_median);
  RUN_TEST(test_pipeline_follows_a_normal_fill);
  RUN_TEST(test_pipeline_repeated_identical_readings_stay_valid);
  RUN_TEST(test_calibration_capture_needs_settled_window);
  RUN_TEST(test_boot_is_disarmed_and_closed);
  RUN_TEST(test_uncommissioned_unit_cannot_arm);
  RUN_TEST(test_auto_fill_hysteresis);
  RUN_TEST(test_estop_closes_latches_and_needs_release_plus_ack);
  RUN_TEST(test_float_trip_needs_thirty_healthy_seconds_and_ack);
  RUN_TEST(test_k1_feedback_mismatch_raises_system_fault);
  RUN_TEST(test_stale_sensor_closes_and_missing_data_never_opens);
  RUN_TEST(test_fill_timeout_latches);
  RUN_TEST(test_no_progress_warns_at_ten_and_closes_at_twenty_minutes);
  RUN_TEST(test_auto_retry_waits_and_never_clears_safety_latches);
  RUN_TEST(test_auto_retry_reopens_after_the_interval);
  RUN_TEST(test_manual_open_is_time_limited_and_protected);
  RUN_TEST(test_close_is_always_honoured_and_leaves_auto);
  RUN_TEST(test_maintenance_expires_back_to_previous_mode);
  RUN_TEST(test_lockout_and_disarm_close_the_valve);
  RUN_TEST(test_invalid_config_stays_closed_and_cannot_arm);
  RUN_TEST(test_estop_latch_survives_a_reboot);
  RUN_TEST(test_config_change_ends_a_fill);
  RUN_TEST(test_millis_rollover_does_not_break_timers);
  return UNITY_END();
}
