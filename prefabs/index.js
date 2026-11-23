// prefabs/index.js: Unified Prefabs registry.
(function (global) {
  'use strict';

  global.Prefabs = Object.assign(
    {},
    global.PrefabVehicles || {},
    global.PrefabNature || {},
    global.PrefabArch || {},
    global.PrefabProps || {},
    global.PrefabCharacters || {}
  );
})(typeof window !== 'undefined' ? window : globalThis);
