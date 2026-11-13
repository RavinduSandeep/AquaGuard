// AquaGuard central pin map - ESP32-S3 DevKitC-1 N16R8 (guide section 6).
// These are GPIO numbers, not physical header positions.
#pragma once
#include <stdint.h>

constexpr uint8_t PIN_OLED_SDA = 8;       // pull up to 3.3 V only
constexpr uint8_t PIN_OLED_SCL = 9;
constexpr uint8_t PIN_SENSOR_RX = 18;     // from U2 CD4050 pin 2 (RS485 receive)
constexpr uint8_t PIN_SENSOR_TX = 17;     // reserved, left unconnected
constexpr uint8_t PIN_VALVE = 6;          // via U1 74HCT125 to Q1 gate, 47k pulldown
constexpr uint8_t PIN_WS2812 = 7;         // via U1 to the 8 pixel strip
constexpr uint8_t PIN_BUZZER = 10;        // 1k to Q2 base
constexpr uint8_t PIN_FLOAT_OK = 4;       // PC817 collector: LOW healthy, HIGH trip/open loop
constexpr uint8_t PIN_ESTOP_OK = 5;       // E-stop NC2: LOW healthy, HIGH pressed/open wire
constexpr uint8_t PIN_K1_FEEDBACK = 11;   // K1 pole 2: LOW energised
constexpr uint8_t PIN_ACK_BUTTON = 12;    // normally open to 0 V, internal pull-up

// Do not load GPIO0, 3, 45, 46 (boot straps), 19/20 (USB), 43/44 (UART0),
// or 35-37 (N16R8 octal PSRAM).

// The buffer + MOSFET stage is active HIGH (VALVE_ACTIVE_HIGH = true).
constexpr bool VALVE_ACTIVE_HIGH = true;
constexpr uint8_t VALVE_ON_LEVEL = VALVE_ACTIVE_HIGH ? 1 : 0;
constexpr uint8_t VALVE_OFF_LEVEL = VALVE_ACTIVE_HIGH ? 0 : 1;

constexpr uint8_t WS2812_PIXELS = 8;
constexpr uint8_t OLED_I2C_ADDRESS = 0x3C;
constexpr uint32_t SENSOR_BAUD = 9600;    // 8N1, automatic output about every 100 ms
