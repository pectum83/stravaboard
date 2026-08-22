import { describe, expect, it } from 'vitest'
import { buildTcx, type TcxInput } from '../tcx/buildTcx.js'

/** Five samples, 10 s apart, with exactly known ground truth. */
function input(overrides: Partial<TcxInput> = {}): TcxInput {
  return {
    startDate: '2026-08-18T07:16:56Z',
    sport: 'Other',
    totalTimeS: 40,
    distanceM: 123.4,
    streams: {
      time: [0, 10, 20, 30, 40],
      distance: [0, 30, 60, 95, 123.4],
      altitude: [1000, 1005, 1011.25, 1018, 1024],
      latlng: [
        [45.1, 6.1],
        [45.2, 6.2],
        [45.3, 6.3],
        [45.4, 6.4],
        [45.5, 6.5],
      ],
      heartrate: [88, 110, 132.4, 145, 151],
      cadence: [0, 60, 62, 64, 300],
    },
    ...overrides,
  }
}

describe('buildTcx', () => {
  it('writes one trackpoint per sample, timestamped from the start date', () => {
    const xml = buildTcx(input())
    expect(xml.match(/<Trackpoint>/g)).toHaveLength(5)
    expect(xml).toContain('<Id>2026-08-18T07:16:56Z</Id>')
    expect(xml).toContain('<Lap StartTime="2026-08-18T07:16:56Z">')
    expect(xml).toContain('<Time>2026-08-18T07:16:56Z</Time>')
    // last sample = start + 40 s
    expect(xml).toContain('<Time>2026-08-18T07:17:36Z</Time>')
  })

  it('carries heart rate as whole beats per minute', () => {
    const xml = buildTcx(input())
    expect(xml).toContain(
      '<HeartRateBpm>\n              <Value>88</Value>\n            </HeartRateBpm>',
    )
    expect(xml).toContain('<Value>132</Value>') // 132.4 rounded
    expect(xml.match(/<HeartRateBpm>/g)).toHaveLength(5)
  })

  it('orders the trackpoint children as the schema requires', () => {
    const xml = buildTcx(input())
    const point = xml.slice(xml.indexOf('<Trackpoint>'), xml.indexOf('</Trackpoint>'))
    const order = [
      ...point.matchAll(/<(Time|Position|AltitudeMeters|DistanceMeters|HeartRateBpm|Cadence)>/g),
    ]
    expect(order.map((m) => m[1])).toEqual([
      'Time',
      'Position',
      'AltitudeMeters',
      'DistanceMeters',
      'HeartRateBpm',
      'Cadence',
    ])
  })

  it('keeps positions, altitude and distance from their streams', () => {
    const xml = buildTcx(input())
    expect(xml).toContain('<LatitudeDegrees>45.1</LatitudeDegrees>')
    expect(xml).toContain('<LongitudeDegrees>6.5</LongitudeDegrees>')
    expect(xml).toContain('<AltitudeMeters>1011.3</AltitudeMeters>') // 1011.25 → one decimal
    expect(xml).toContain('<DistanceMeters>123.4</DistanceMeters>')
  })

  it('caps cadence at the schema maximum', () => {
    expect(buildTcx(input())).toContain('<Cadence>254</Cadence>')
  })

  it('omits the elements whose stream is missing', () => {
    const xml = buildTcx(input({ streams: { time: [0, 10], heartrate: [90, 95] } }))
    expect(xml).toContain('<Value>90</Value>')
    expect(xml).not.toContain('<Position>')
    expect(xml).not.toContain('<AltitudeMeters>')
    expect(xml).not.toContain('<Cadence>')
  })

  it('skips a single point without GPS instead of dropping the sample', () => {
    const streams = input().streams
    const holed = [...(streams.latlng ?? [])] as [number, number][]
    holed[2] = [NaN, NaN]
    const xml = buildTcx(input({ streams: { ...streams, latlng: holed } }))
    expect(xml.match(/<Trackpoint>/g)).toHaveLength(5)
    expect(xml.match(/<Position>/g)).toHaveLength(4)
  })

  it('writes calories only when known', () => {
    expect(buildTcx(input())).not.toContain('<Calories>')
    expect(buildTcx(input({ calories: 412.6 }))).toContain('<Calories>413</Calories>')
  })

  it('names the sport on the activity', () => {
    expect(buildTcx(input({ sport: 'Running' }))).toContain('<Activity Sport="Running">')
  })

  it('rejects an empty time stream', () => {
    expect(() => buildTcx(input({ streams: { time: [] } }))).toThrow(/without a time stream/)
  })

  it('rejects an invalid start date', () => {
    expect(() => buildTcx(input({ startDate: 'not a date' }))).toThrow(/invalid start date/)
  })

  it('rejects streams of mismatched length', () => {
    expect(() => buildTcx(input({ streams: { time: [0, 10], heartrate: [90] } }))).toThrow(
      /"heartrate" has 1 samples, expected 2/,
    )
  })
})
