/** Synthetic stream builders with known ground truth. */

export interface Streams {
  time: number[]
  distance: number[]
  altitude: number[]
}

/**
 * Constant-grade ramp sampled at 1 Hz: horizontal speed `speedMS` m/s,
 * climbing `vSpeedMS` m/s. Ground truth vertical speed = vSpeedMS * 3600 m/h.
 */
export function ramp(durationS: number, speedMS: number, vSpeedMS: number): Streams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= durationS; t++) {
    time.push(t)
    distance.push(t * speedMS)
    altitude.push(100 + t * vSpeedMS)
  }
  return { time, distance, altitude }
}

/** Flat walk at 1 m/s. */
export function flat(durationS: number): Streams {
  return ramp(durationS, 1, 0)
}

/**
 * Climb at +0.5 m/s interrupted every `periodS` seconds by a dip of `dipM`
 * meters (drop then immediate recovery, 1 m per second each way).
 */
export function sawtoothClimb(durationS: number, periodS: number, dipM: number): Streams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  let alt = 100
  let phase: 'up' | 'down' | 'recover' = 'up'
  let phaseLeft = periodS
  for (let t = 0; t <= durationS; t++) {
    time.push(t)
    distance.push(t)
    altitude.push(alt)
    if (phase === 'up') {
      alt += 0.5
      phaseLeft--
      if (phaseLeft <= 0) {
        phase = 'down'
        phaseLeft = dipM
      }
    } else if (phase === 'down') {
      alt -= 1
      phaseLeft--
      if (phaseLeft <= 0) {
        phase = 'recover'
        phaseLeft = dipM
      }
    } else {
      alt += 1
      phaseLeft--
      if (phaseLeft <= 0) {
        phase = 'up'
        phaseLeft = periodS
      }
    }
  }
  return { time, distance, altitude }
}

/** Ramp with a recording gap (auto-pause): time jumps by `gapS` in the middle. */
export function rampWithGap(durationS: number, gapS: number): Streams {
  const { time, distance, altitude } = ramp(durationS, 1, 0.5)
  const mid = Math.floor(time.length / 2)
  for (let i = mid; i < time.length; i++) time[i] = time[i]! + gapS
  return { time, distance, altitude }
}

/** Add a bad-GPS altitude spike of `deltaM` meters at `atIndex` (single sample). */
export function spike(streams: Streams, atIndex: number, deltaM: number): Streams {
  const altitude = [...streams.altitude]
  altitude[atIndex] = altitude[atIndex]! + deltaM
  return { ...streams, altitude }
}

export interface StreamsWithLatlng extends Streams {
  latlng: [number, number][]
}

/** Meters of northward travel per degree of latitude. */
const M_PER_DEG_LAT = 111_320

/**
 * Derive a GPS track from the distance stream: a straight line heading north
 * from [45.1, 6.05], so latlng displacement matches distance exactly.
 */
export function withLatlng(streams: Streams): StreamsWithLatlng {
  const latlng = streams.distance.map((d): [number, number] => [45.1 + d / M_PER_DEG_LAT, 6.05])
  return { ...streams, latlng }
}

/**
 * Deterministic GPS jitter: offsets each point by up to `amplitudeM` meters
 * (golden-angle phase, no randomness so tests are reproducible).
 */
export function jitterLatlng(latlng: [number, number][], amplitudeM: number): [number, number][] {
  return latlng.map(([lat, lng], i) => [
    lat + (amplitudeM * Math.sin(i * 2.399)) / M_PER_DEG_LAT,
    lng,
  ])
}

/**
 * Insert a standstill after sample `atIndex`: `durationS` extra 1 Hz samples
 * repeating that sample's position, distance and altitude; later samples keep
 * their values with time shifted by `durationS`.
 */
export function insertPause(
  streams: StreamsWithLatlng,
  atIndex: number,
  durationS: number,
): StreamsWithLatlng {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  const latlng: [number, number][] = []
  const push = (t: number, i: number) => {
    time.push(t)
    distance.push(streams.distance[i]!)
    altitude.push(streams.altitude[i]!)
    latlng.push(streams.latlng[i]!)
  }
  for (let i = 0; i <= atIndex; i++) push(streams.time[i]!, i)
  for (let k = 1; k <= durationS; k++) push(streams.time[atIndex]! + k, atIndex)
  for (let i = atIndex + 1; i < streams.time.length; i++) push(streams.time[i]! + durationS, i)
  return { time, distance, altitude, latlng }
}
