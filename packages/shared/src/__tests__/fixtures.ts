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
