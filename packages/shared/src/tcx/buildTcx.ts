/**
 * Serializes activity streams into a Garmin TCX v2 document.
 *
 * Strava's API cannot attach streams to an existing activity: re-creating an
 * activity on another account means uploading a file. TCX is the simplest
 * format that carries heart rate (GPX only does through vendor extensions),
 * and heart rate is what Strava needs to recompute Relative Effort and the
 * fitness curve.
 */

/** The only sports the TCX v2 schema accepts; everything else maps to `Other`. */
export type TcxSport = 'Running' | 'Biking' | 'Other'

/** Per-point streams, all sampled on the same clock as `time`. */
export interface TcxStreams {
  /** Seconds since the activity start. Drives the trackpoint count. */
  time: number[]
  /** Meters from start. */
  distance?: number[]
  /** Meters above sea level. */
  altitude?: number[]
  /** `[lat, lng]` pairs; individual points may be null-ish and are then skipped. */
  latlng?: [number, number][]
  /** Beats per minute. */
  heartrate?: number[]
  /** Revolutions (or steps) per minute. */
  cadence?: number[]
}

export interface TcxInput {
  /** Activity start, ISO 8601 UTC (`2026-08-18T07:16:56Z`). */
  startDate: string
  sport: TcxSport
  /** Lap duration, seconds — Strava reads it as the elapsed time. */
  totalTimeS: number
  distanceM: number
  calories?: number
  streams: TcxStreams
}

/** Streams whose length must match `time`; a mismatch means a corrupt fetch. */
const ALIGNED_KEYS = ['distance', 'altitude', 'latlng', 'heartrate', 'cadence'] as const

/**
 * Build a single-lap TCX document. Child order inside `<Trackpoint>` follows the
 * schema (Time, Position, AltitudeMeters, DistanceMeters, HeartRateBpm,
 * Cadence); elements are omitted wherever the sample is missing.
 *
 * The document carries no free text — the activity name and description travel
 * as multipart fields of the upload — so nothing here needs XML escaping.
 */
export function buildTcx(input: TcxInput): string {
  const { streams } = input
  if (streams.time.length === 0) throw new Error('cannot build a TCX without a time stream')
  const startMs = Date.parse(input.startDate)
  if (Number.isNaN(startMs)) throw new Error(`invalid start date: ${input.startDate}`)
  for (const key of ALIGNED_KEYS) {
    const stream = streams[key]
    if (stream !== undefined && stream.length !== streams.time.length) {
      throw new Error(
        `stream "${key}" has ${stream.length} samples, expected ${streams.time.length}`,
      )
    }
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase' +
      ' xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2' +
      ' http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"' +
      ' xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <Activities>',
    `    <Activity Sport="${input.sport}">`,
    `      <Id>${isoAt(startMs, 0)}</Id>`,
    `      <Lap StartTime="${isoAt(startMs, 0)}">`,
    `        <TotalTimeSeconds>${num(input.totalTimeS)}</TotalTimeSeconds>`,
    `        <DistanceMeters>${num(input.distanceM)}</DistanceMeters>`,
    ...(input.calories === undefined
      ? []
      : [`        <Calories>${round(input.calories)}</Calories>`]),
    '        <Intensity>Active</Intensity>',
    '        <TriggerMethod>Manual</TriggerMethod>',
    '        <Track>',
  ]

  for (let i = 0; i < streams.time.length; i++) {
    lines.push('          <Trackpoint>')
    lines.push(`            <Time>${isoAt(startMs, streams.time[i] ?? 0)}</Time>`)
    const point = streams.latlng?.[i]
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      lines.push('            <Position>')
      lines.push(`              <LatitudeDegrees>${coord(point[0])}</LatitudeDegrees>`)
      lines.push(`              <LongitudeDegrees>${coord(point[1])}</LongitudeDegrees>`)
      lines.push('            </Position>')
    }
    const altitude = streams.altitude?.[i]
    if (altitude !== undefined && Number.isFinite(altitude)) {
      lines.push(`            <AltitudeMeters>${num(altitude)}</AltitudeMeters>`)
    }
    const distance = streams.distance?.[i]
    if (distance !== undefined && Number.isFinite(distance)) {
      lines.push(`            <DistanceMeters>${num(distance)}</DistanceMeters>`)
    }
    const heartrate = streams.heartrate?.[i]
    if (heartrate !== undefined && Number.isFinite(heartrate)) {
      lines.push('            <HeartRateBpm>')
      lines.push(`              <Value>${round(heartrate)}</Value>`)
      lines.push('            </HeartRateBpm>')
    }
    const cadence = streams.cadence?.[i]
    if (cadence !== undefined && Number.isFinite(cadence)) {
      // The schema caps Cadence at 254 rpm; anything above is a sensor glitch.
      lines.push(`            <Cadence>${Math.min(round(cadence), 254)}</Cadence>`)
    }
    lines.push('          </Trackpoint>')
  }

  lines.push('        </Track>', '      </Lap>', '    </Activity>', '  </Activities>')
  lines.push('</TrainingCenterDatabase>', '')
  return lines.join('\n')
}

/** `start + offset` seconds as an ISO 8601 UTC timestamp, whole seconds. */
function isoAt(startMs: number, offsetS: number): string {
  return new Date(startMs + Math.round(offsetS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** At most one decimal place, no trailing `.0` — TCX floats stay short. */
function num(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * Degrees keep seven decimals — about a centimetre. Rounding them like the
 * other floats would flatten the whole track onto a handful of points.
 */
function coord(value: number): string {
  return String(Math.round(value * 1e7) / 1e7)
}

function round(value: number): number {
  return Math.round(value)
}
