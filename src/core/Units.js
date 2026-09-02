export const MAP_SIZE = 4096;      // metres
export const CELL = 8;             // metres
export const PLAY_SIZE = 2048;     // metres, playable core
export const CAMERA_FOV = 45;
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 6000;
export const DAY_LENGTH_REAL_SECONDS = 24 * 24; // at speed 60: 24 real minutes per game day
export const ZONES = ['none', 'res-low', 'res-high', 'com-low', 'com-high', 'ind', 'office'];
export const ROAD_TYPES = {
  alley:   { width: 8,  lanes: 2, oneWay: false, speed: 8 },
  local:   { width: 16, lanes: 2, oneWay: false, speed: 12 },
  avenue:  { width: 24, lanes: 4, oneWay: false, speed: 16 },
  highway: { width: 32, lanes: 6, oneWay: false, speed: 28 },
};
