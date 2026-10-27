// Drawing a City Corporation's area: converting outlines, simplifying a hand-drawn line, spotting a self-crossing one.

export type LatLng = [number, number]

/** Outer ring of the first polygon, as Leaflet [lat, lng] points (closing point dropped). */
export function ringFromGeoJSON(area: GeoJSON.MultiPolygon | GeoJSON.Polygon | null | undefined): LatLng[] {
  if (!area) return []
  const ring = area.type === 'MultiPolygon' ? area.coordinates[0]?.[0] : area.coordinates[0]
  return (ring ?? []).slice(0, -1).map(([lng, lat]) => [lat, lng])
}

export function polygonFromRing(points: LatLng[]): GeoJSON.Polygon {
  const ring = points.map(([lat, lng]) => [lng, lat])
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}

/**
 * Fewer points along a hand-drawn line, keeping its shape (Douglas–Peucker): drops every point closer than
 * `tolerance` to the line between the points kept around it. Works on any [x, y] pairs, e.g. screen pixels.
 * Returns the indexes kept, in order, so the caller can map them back to map coordinates.
 */
export function simplifyPath(points: [number, number][], tolerance: number): number[] {
  if (points.length < 3) return points.map((_, i) => i)
  const keep = new Set([0, points.length - 1])
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const len = Math.hypot(bx - ax, by - ay)
    let far = -1
    let farDist = tolerance
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      if (d > farDist) {
        far = i
        farDist = d
      }
    }
    if (far !== -1) {
      keep.add(far)
      stack.push([a, far], [far, b])
    }
  }
  return [...keep].sort((x, y) => x - y)
}

/** Does the closed outline cross itself? The database refuses such an area, so the drawer warns first. */
export function ringCrossesItself(ring: LatLng[]): boolean {
  const n = ring.length
  if (n < 4) return false
  const side = (p: LatLng, q: LatLng, r: LatLng) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue  // neighbours through the closing edge
      const c = ring[j]
      const d = ring[(j + 1) % n]
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true
    }
  }
  return false
}
