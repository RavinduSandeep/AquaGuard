#pragma once

namespace webapi {
// Starts Wi-Fi (station, or the protected setup access point when no network
// is stored or `forceSetupAp` is set) and the HTTP server.
void begin(bool forceSetupAp);
// Call from loop(): SSE status push, reconnects and deferred restarts.
void loop();
}  // namespace webapi
