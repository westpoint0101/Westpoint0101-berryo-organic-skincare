(function () {
  "use strict";

  var config = window.BERRYO_SUPABASE_CONFIG;
  if (!config || !config.url || !config.anonKey) {
    return;
  }

  window.BERRYO_AUTOMATION_ENABLED = true;
})();
