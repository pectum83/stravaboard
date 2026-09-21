/**
 * Splices two consecutive activities into one set of streams, fabricating the
 * stretch the watch never recorded.
 *
 * The case this exists for: the recording stops at the top of a climb and only
 * restarts for the descent, leaving one outing split in two. Strava cannot
 * merge activities and cannot attach streams to an existing one, so the only
 * route is a single uploaded file — which means the gap has to be filled with
 * samples rather than left empty.
 *
 * The fabricated bridge is a **stand still, then walk** profile: the athlete
 * stays put where the first recording ended, then walks to where the second one
 * starts. Everything here is deterministic — no randomness — so the result can
 * be asserted point by point in tests and reproduced byte for byte.
 */
import { haversineM } from '../vspeed/pauses.js'
import type { TcxStreams } from './buildTcx.js'

export type BridgeErrorCode =
  /** A stream's length does not match its own time stream. */
  | 'misaligned'
  /** An input time stream is not strictly increasing. */
  | 'not-increasing'
  /** One side carries no distance stream; the bridge cannot be measured. */
  | 'no-distance'
  /** One side carries no usable position; a path cannot be invented. */
  | 'no-latlng'
  /** The second activity starts before the first one ends. */
  | 'overlap'
  /** `offsetS` is not a whole number of seconds. */
  | 'bad-offset'
  /** Both the pause and the walking speed were given; one determines the other. */
  | 'over-determined'
  /** The two ends are too far apart, too close, or separated by a cliff. */
  | 'implausible-bridge'
  /** The resulting walking speed is not something a human does. */
  | 'implausible-speed'

/** Refusal to fabricate a bridge — the two activities cannot be joined as asked. */
export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface BridgeOptions {
  /**
   * Start of the second activity, in seconds after the start of the first —
   * i.e. the difference of their Strava `start_date`s.
   */
  offsetS: number
  /**
   * Seconds spent standing still before walking. Mutually exclusive with
   * `cruiseSpeedMps`: whichever is given, the other follows from the distance.
   */
  pauseS?: number
  /** Plateau walking speed. Defaults to 1.15 m/s (≈ 4.1 km/h). */
  cruiseSpeedMps?: number
  /** Acceleration/deceleration ramp at each end of the walk. */
  rampS?: number
  /** Sampling interval while walking. */
  sampleS?: number
  /** Sampling interval while standing still — a watch does not log 4 s apart. */
  pauseSampleS?: number
  /** Lateral bow of the invented path, so it is not a laser-straight line. */
  bowM?: number
  /**
   * Amplitude of an altitude ripple along the walk. Zero by default **because
   * it fabricates elevation gain**: Strava recomputes D+ from the track, so a
   * ±2.5 m ripple over a quarter of an hour invents tens of meters of climb.
   */
  undulationM?: number
  /** Heart rate while walking. Defaults to the median of the second activity's first minutes. */
  walkHr?: number
  /** Heart rate at rest. Defaults to 78 % of the walking value. */
  restHr?: number
  /** Cadence while walking at the plateau speed. Defaults to the observed median. */
  walkCadence?: number
}

export interface BridgeStats {
  /** Seconds the recording never covered. */
  gapS: number
  pauseS: number
  walkS: number
  /** Plateau speed the trapezoid settles at — derived, never an input. */
  vPlateauMps: number
  /** Arc length of the invented path, integrated over the points actually emitted. */
  lengthM: number
  /** Samples the bridge contributes. */
  points: number
  /** Altitude of the second start minus altitude of the first end. */
  elevationDeltaM: number
}

export interface MergedStreams {
  streams: TcxStreams
  bridge: BridgeStats
  /** Streams dropped because only one of the two activities carried them. */
  dropped: string[]
  /**
   * Seconds to add to the first activity's `start_date` before building the
   * TCX: its time stream is normalised to start at zero.
   */
  startShiftS: number
}

const DEFAULT_RAMP_S = 60
const DEFAULT_SAMPLE_S = 4
const DEFAULT_PAUSE_SAMPLE_S = 30
const DEFAULT_BOW_M = 20
const DEFAULT_UNDULATION_M = 0
const DEFAULT_CRUISE_MPS = 1.15

/** Sub-samples used to integrate the invented path into an arc-length table. */
const PATH_STEPS = 400
const MIN_BRIDGE_M = 1
const MAX_BRIDGE_M = 5_000
/** Steeper than this between the two ends and the bridge would cross a cliff. */
const MAX_BRIDGE_GRADE = 0.6
const MIN_WALK_MPS = 0.3
const MAX_WALK_MPS = 3

/** Heart-rate recovery once standing still, and the climb back once walking. */
const HR_RECOVERY_TAU_S = 120
const HR_EFFORT_TAU_S = 90
/** A heart rate flat to the beat for twenty minutes is the giveaway; drift it. */
const HR_DRIFT_BPM = 1.5
const HR_DRIFT_PERIOD_S = 180
/** Seconds over which the bridge blends into the second activity's first beat. */
const HR_BLEND_S = 60
/** Window used to read a representative walking heart rate and cadence. */
const SAMPLE_WINDOW_S = 300
const REST_HR_FRACTION = 0.78
const MIN_REST_HR = 60
const MAX_REST_HR = 100
/** Altitude ripple is tapered to zero over this long at each end of the walk. */
const UNDULATION_TAPER_S = 60
const UNDULATION_PERIOD_S = 240

const EARTH_RADIUS_M = 6_371_000
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180

const OPTIONAL_KEYS = ['altitude', 'heartrate', 'cadence'] as const
type OptionalKey = (typeof OPTIONAL_KEYS)[number]

/**
 * Splice `second` onto `first`, inventing the samples in between.
 *
 * Both sides keep their own samples untouched; only the gap is fabricated. The
 * bridge length is measured on the path that is actually emitted, and the
 * walking speed follows from it — never the other way round, or the distance
 * written to the file would not match the track drawn on the map.
 */
export function mergeTcxStreams(
  first: TcxStreams,
  second: TcxStreams,
  options: BridgeOptions,
): MergedStreams {
  if (options.pauseS !== undefined && options.cruiseSpeedMps !== undefined) {
    throw new BridgeError(
      'over-determined',
      'pass either a pause or a walking speed: the bridge distance fixes the other',
    )
  }
  if (!Number.isInteger(options.offsetS)) {
    throw new BridgeError('bad-offset', `offsetS must be whole seconds, got ${options.offsetS}`)
  }
  checkStreams('first', first)
  checkStreams('second', second)

  const rampWanted = options.rampS ?? DEFAULT_RAMP_S
  const sampleS = options.sampleS ?? DEFAULT_SAMPLE_S
  const pauseSampleS = options.pauseSampleS ?? DEFAULT_PAUSE_SAMPLE_S
  const bowM = options.bowM ?? DEFAULT_BOW_M
  const undulationM = options.undulationM ?? DEFAULT_UNDULATION_M

  // Both sides are normalised: Strava streams usually start at 0, but an
  // activity trimmed at the head does not, and the offsets would then be wrong.
  const startShiftS = first.time[0] ?? 0
  const timeA = first.time.map((t) => t - startShiftS)
  const timeB = second.time.map((t) => t - (second.time[0] ?? 0))
  const distA = normalised(first.distance, 'first')
  const distB = normalised(second.distance, 'second')

  const endA = timeA.length - 1
  const lastTimeA = timeA[endA] ?? 0
  const lastDistA = distA[endA] ?? 0
  const bShiftS = options.offsetS - startShiftS + (second.time[0] ?? 0)
  const gapS = bShiftS - lastTimeA
  if (gapS <= 0) {
    throw new BridgeError(
      'overlap',
      `the second activity starts ${-gapS} s before the first one ends`,
    )
  }

  const from = junction(first, 'first', 'last')
  const to = junction(second, 'second', 'first')
  const dropped = OPTIONAL_KEYS.filter(
    (key) => (first[key] === undefined) !== (second[key] === undefined),
  )
  const keep = (key: OptionalKey): boolean => first[key] !== undefined && second[key] !== undefined

  const path = buildPath(first.latlng![from]!, second.latlng![to]!, bowM)
  const lengthM = path.lengthM
  if (lengthM < MIN_BRIDGE_M || lengthM > MAX_BRIDGE_M) {
    throw new BridgeError(
      'implausible-bridge',
      `the two ends are ${lengthM.toFixed(1)} m apart, outside ${MIN_BRIDGE_M}–${MAX_BRIDGE_M} m`,
    )
  }

  const altFrom = keep('altitude') ? (first.altitude![from] ?? 0) : 0
  const altTo = keep('altitude') ? (second.altitude![to] ?? 0) : 0
  const elevationDeltaM = altTo - altFrom
  if (keep('altitude') && Math.abs(elevationDeltaM) / lengthM > MAX_BRIDGE_GRADE) {
    throw new BridgeError(
      'implausible-bridge',
      `the bridge would climb ${elevationDeltaM.toFixed(0)} m over ${lengthM.toFixed(0)} m`,
    )
  }

  const { pauseS, walkS, rampS, vPlateauMps } = schedule(gapS, lengthM, {
    pauseS: options.pauseS,
    cruiseSpeedMps: options.cruiseSpeedMps,
    rampS: rampWanted,
  })

  // Heart rate and cadence are read off the real samples around the gap: a
  // hard-coded 100 spm would spike in the middle of a track whose watch reports
  // one-foot cadence around 50.
  const hrEnd = keep('heartrate') ? (first.heartrate![endA] ?? 0) : 0
  const hrStart = keep('heartrate') ? (second.heartrate![0] ?? 0) : 0
  const walkHr =
    options.walkHr ?? median(headWindow(timeB, second.heartrate, SAMPLE_WINDOW_S)) ?? hrStart
  const restHr =
    options.restHr ??
    Math.min(MAX_REST_HR, Math.max(MIN_REST_HR, Math.round(walkHr * REST_HR_FRACTION)))
  const walkCadence =
    options.walkCadence ??
    median(headWindow(timeB, second.cadence, SAMPLE_WINDOW_S).filter((v) => v > 0)) ??
    0

  const pauseEndT = lastTimeA + pauseS
  const bridgeTimes: number[] = []
  for (let t = lastTimeA + pauseSampleS; t < pauseEndT; t += pauseSampleS) bridgeTimes.push(t)
  for (let t = pauseEndT; t < bShiftS; t += sampleS) {
    if (t > (bridgeTimes[bridgeTimes.length - 1] ?? lastTimeA)) bridgeTimes.push(t)
  }

  const bridgeDistance: number[] = []
  const bridgeAltitude: number[] = []
  const bridgeHeartrate: number[] = []
  const bridgeCadence: number[] = []
  const bridgeLatLng: [number, number][] = []
  for (const t of bridgeTimes) {
    const walking = t > pauseEndT
    const fraction = walking ? travelled((t - pauseEndT) / walkS, rampS / walkS) : 0
    const speedFraction = walking ? rampSpeed((t - pauseEndT) / walkS, rampS / walkS) : 0
    const at = path.atArcFraction(fraction)
    bridgeLatLng.push(walking ? at : path.start)
    bridgeDistance.push(lastDistA + lengthM * fraction)
    bridgeAltitude.push(
      altFrom + elevationDeltaM * fraction + ripple(t - pauseEndT, walkS, undulationM, walking),
    )
    bridgeHeartrate.push(
      heartRate({
        t,
        pauseStart: lastTimeA,
        pauseEndT,
        bridgeEndT: bShiftS,
        hrEnd,
        hrStart,
        restHr,
        walkHr,
      }),
    )
    bridgeCadence.push(Math.round(walkCadence * speedFraction))
  }

  const streams: TcxStreams = {
    time: [...timeA, ...bridgeTimes, ...timeB.map((t) => t + bShiftS)],
    distance: [...distA, ...bridgeDistance, ...distB.map((d) => d + lastDistA + lengthM)],
    latlng: [...first.latlng!, ...bridgeLatLng, ...second.latlng!],
  }
  if (keep('altitude')) {
    streams.altitude = [...first.altitude!, ...bridgeAltitude, ...second.altitude!]
  }
  if (keep('heartrate')) {
    streams.heartrate = [...first.heartrate!, ...bridgeHeartrate, ...second.heartrate!]
  }
  if (keep('cadence')) {
    streams.cadence = [...first.cadence!, ...bridgeCadence, ...second.cadence!]
  }
  checkMonotonic(streams)

  return {
    streams,
    dropped,
    startShiftS,
    bridge: {
      gapS,
      pauseS,
      walkS,
      vPlateauMps,
      lengthM,
      points: bridgeTimes.length,
      elevationDeltaM,
    },
  }
}

/** Pause and walking speed each determine the other; work out the missing one. */
function schedule(
  gapS: number,
  lengthM: number,
  given: { pauseS?: number; cruiseSpeedMps?: number; rampS: number },
): { pauseS: number; walkS: number; rampS: number; vPlateauMps: number } {
  let pauseS: number
  if (given.pauseS !== undefined) {
    pauseS = Math.round(given.pauseS)
  } else {
    // A trapezoid covers v·(walk − ramp), so the ramp costs exactly one ramp
    // length of standing time on top of the constant-speed duration.
    const cruise = given.cruiseSpeedMps ?? DEFAULT_CRUISE_MPS
    pauseS = Math.round(gapS - lengthM / cruise - given.rampS)
  }
  if (pauseS < 0) {
    throw new BridgeError(
      'implausible-speed',
      `walking ${lengthM.toFixed(0)} m needs more than the ${gapS} s available`,
    )
  }
  const walkS = gapS - pauseS
  const rampS = Math.min(given.rampS, walkS / 2)
  if (walkS <= rampS) {
    throw new BridgeError(
      'implausible-speed',
      `only ${walkS} s left to walk ${lengthM.toFixed(0)} m`,
    )
  }
  const vPlateauMps = lengthM / (walkS - rampS)
  if (vPlateauMps < MIN_WALK_MPS || vPlateauMps > MAX_WALK_MPS) {
    throw new BridgeError(
      'implausible-speed',
      `that pause leaves a walking speed of ${(vPlateauMps * 3.6).toFixed(1)} km/h`,
    )
  }
  return { pauseS, walkS, rampS, vPlateauMps }
}

/** Fraction of the plateau speed at `u` ∈ [0, 1] of the walk (trapezoid). */
function rampSpeed(u: number, rampFraction: number): number {
  if (u <= 0 || u >= 1) return 0
  if (rampFraction === 0) return 1
  if (u < rampFraction) return u / rampFraction
  if (u > 1 - rampFraction) return (1 - u) / rampFraction
  return 1
}

/** Fraction of the distance covered at `u` — the normalised integral of `rampSpeed`. */
function travelled(u: number, rampFraction: number): number {
  const clamped = Math.min(1, Math.max(0, u))
  const r = rampFraction
  if (r === 0) return clamped
  const total = 1 - r
  if (clamped < r) return (clamped * clamped) / (2 * r) / total
  if (clamped <= 1 - r) return (clamped - r / 2) / total
  const left = 1 - clamped
  return (total - (left * left) / (2 * r)) / total
}

/**
 * Altitude ripple, tapered to zero at both ends of the walk so the invented
 * stretch meets the real samples flush instead of with a step.
 */
function ripple(elapsed: number, walkS: number, amplitude: number, walking: boolean): number {
  if (!walking || amplitude === 0) return 0
  const edge = Math.min(elapsed, walkS - elapsed)
  const taper = Math.min(1, Math.max(0, edge / UNDULATION_TAPER_S))
  return (
    amplitude *
    Math.sin((taper * Math.PI) / 2) ** 2 *
    Math.sin((2 * Math.PI * elapsed) / UNDULATION_PERIOD_S)
  )
}

interface HeartRateAt {
  t: number
  pauseStart: number
  pauseEndT: number
  bridgeEndT: number
  hrEnd: number
  hrStart: number
  restHr: number
  walkHr: number
}

/** Exponential recovery while still, exponential climb once walking, blended into the next activity. */
function heartRate(at: HeartRateAt): number {
  const drift = HR_DRIFT_BPM * Math.sin((2 * Math.PI * (at.t - at.pauseStart)) / HR_DRIFT_PERIOD_S)
  let value: number
  if (at.t <= at.pauseEndT) {
    const elapsed = at.t - at.pauseStart
    value = at.restHr + (at.hrEnd - at.restHr) * Math.exp(-elapsed / HR_RECOVERY_TAU_S)
  } else {
    const atPauseEnd =
      at.restHr +
      (at.hrEnd - at.restHr) * Math.exp(-(at.pauseEndT - at.pauseStart) / HR_RECOVERY_TAU_S)
    const elapsed = at.t - at.pauseEndT
    value = at.walkHr + (atPauseEnd - at.walkHr) * Math.exp(-elapsed / HR_EFFORT_TAU_S)
  }
  // Land exactly on the next activity's first beat rather than stepping onto it.
  const blend = Math.min(1, Math.max(0, (at.t - (at.bridgeEndT - HR_BLEND_S)) / HR_BLEND_S))
  return Math.round((1 - blend) * (value + drift) + blend * at.hrStart)
}

interface Path {
  start: [number, number]
  lengthM: number
  atArcFraction(fraction: number): [number, number]
}

/**
 * A gently bowed path between two points, sampled into an arc-length table.
 *
 * Linear interpolation in degrees (with a cosine correction on longitude) is
 * exact to the millimetre over a kilometre; the table exists so that a
 * *distance* fraction maps to the matching point, which a raw parameter would
 * not once the bow makes the path longer than the chord.
 */
function buildPath(a: [number, number], b: [number, number], bowM: number): Path {
  const latMid = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(latMid)
  const east = (b[1] - a[1]) * mPerDegLng
  const north = (b[0] - a[0]) * M_PER_DEG_LAT
  const norm = Math.hypot(east, north)

  const at = (u: number): [number, number] => {
    const lat = a[0] + u * (b[0] - a[0])
    const lng = a[1] + u * (b[1] - a[1])
    if (bowM === 0 || norm === 0) return [lat, lng]
    const offset = bowM * Math.sin(Math.PI * u)
    const dLat = ((-east / norm) * offset) / M_PER_DEG_LAT
    const dLng = ((north / norm) * offset) / mPerDegLng
    return [lat + dLat, lng + dLng]
  }

  const points: [number, number][] = []
  const cumulative: number[] = [0]
  for (let k = 0; k <= PATH_STEPS; k++) {
    const point = at(k / PATH_STEPS)
    points.push(point)
    if (k > 0) cumulative.push(cumulative[k - 1]! + haversineM(points[k - 1]!, point))
  }
  const lengthM = cumulative[PATH_STEPS]!

  return {
    start: points[0]!,
    lengthM,
    atArcFraction(fraction: number): [number, number] {
      const target = Math.min(1, Math.max(0, fraction)) * lengthM
      let hi = 1
      while (hi < PATH_STEPS && cumulative[hi]! < target) hi++
      const lo = hi - 1
      const span = cumulative[hi]! - cumulative[lo]!
      const t = span === 0 ? 0 : (target - cumulative[lo]!) / span
      const p = points[lo]!
      const q = points[hi]!
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]
    },
  }
}

/** Index of the outermost sample carrying a real fix — a [0, 0] is a watch still searching. */
function junction(streams: TcxStreams, side: string, end: 'first' | 'last'): number {
  const latlng = streams.latlng
  if (latlng === undefined || latlng.length === 0) {
    throw new BridgeError('no-latlng', `the ${side} activity carries no position stream`)
  }
  const indexes = end === 'last' ? [...latlng.keys()].reverse() : [...latlng.keys()]
  for (const i of indexes) {
    const point = latlng[i]!
    if (
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      (point[0] !== 0 || point[1] !== 0)
    ) {
      return i
    }
  }
  throw new BridgeError('no-latlng', `the ${side} activity never got a position fix`)
}

function normalised(distance: number[] | undefined, side: string): number[] {
  if (distance === undefined || distance.length === 0) {
    throw new BridgeError('no-distance', `the ${side} activity carries no distance stream`)
  }
  const base = distance[0]!
  return distance.map((d) => d - base)
}

function checkStreams(side: string, streams: TcxStreams): void {
  if (streams.time.length === 0) {
    throw new BridgeError('misaligned', `the ${side} activity has an empty time stream`)
  }
  for (const [key, stream] of Object.entries(streams)) {
    if (key === 'time' || stream === undefined) continue
    if ((stream as unknown[]).length !== streams.time.length) {
      throw new BridgeError(
        'misaligned',
        `the ${side} activity's "${key}" has ${(stream as unknown[]).length} samples, expected ${streams.time.length}`,
      )
    }
  }
  for (let i = 1; i < streams.time.length; i++) {
    if (streams.time[i]! <= streams.time[i - 1]!) {
      throw new BridgeError(
        'not-increasing',
        `the ${side} activity's time stream goes backwards at sample ${i}`,
      )
    }
  }
}

function checkMonotonic(streams: TcxStreams): void {
  for (let i = 1; i < streams.time.length; i++) {
    if (streams.time[i]! <= streams.time[i - 1]!) {
      throw new BridgeError('not-increasing', `merged time stream stalls at sample ${i}`)
    }
    if (streams.distance![i]! < streams.distance![i - 1]!) {
      throw new BridgeError(
        'not-increasing',
        `merged distance stream goes backwards at sample ${i}`,
      )
    }
  }
}

/** Samples of `stream` falling in the first `windowS` seconds of `time`. */
function headWindow(time: number[], stream: number[] | undefined, windowS: number): number[] {
  if (stream === undefined) return []
  const limit = (time[0] ?? 0) + windowS
  const out: number[] = []
  for (let i = 0; i < stream.length && (time[i] ?? 0) <= limit; i++) out.push(stream[i]!)
  return out
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
