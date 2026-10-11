import clsx from 'clsx'
import { BadgeCheck, CircleCheckBig, MapPin } from 'lucide-react'
import type { CSSProperties } from 'react'

// Deterministic pseudo-random numbers, so the city looks the same on every render and every visit.
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

// The city is drawn once at module load: a street grid with blocks, a few parks, two main roads and a river.
const CITY = (() => {
  const r = rng(42)
  const lines = [0, 95, 190, 300, 400, 505, 610, 700, 800, 905, 1000]
  const blocks: { x: number; y: number; w: number; h: number; park: boolean }[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      const x = lines[i] + 9
      const y = lines[j] + 9
      const w = lines[i + 1] - lines[i] - 18
      const h = lines[j + 1] - lines[j] - 18
      // Some blocks are split into two buildings, so the grid doesn't look like graph paper.
      if (r() < 0.45) {
        const split = 0.35 + r() * 0.3
        blocks.push({ x, y, w: w * split - 4, h, park: false }, { x: x + w * split + 4, y, w: w * (1 - split) - 4, h, park: false })
      } else {
        blocks.push({ x, y, w, h, park: r() < 0.12 })
      }
    }
  }
  return { lines, blocks }
})()

// Where the issue pins land (percent of the city plane), their colour, and when each one drops (seconds).
const PINS = [
  { x: 42, y: 40, c: '#e5383b', d: 0 },
  { x: 56, y: 47, c: '#f59f00', d: 1.6 },
  { x: 47, y: 58, c: '#1a6fd1', d: 3.1 },
  { x: 61, y: 36, c: '#2f9e44', d: 4.4 },
  { x: 36, y: 52, c: '#ae3ec9', d: 5.8 },
  { x: 52, y: 33, c: '#e5383b', d: 7.0 },
]

const HEAT = [
  { x: 44, y: 44, s: 230 },
  { x: 58, y: 40, s: 170 },
  { x: 49, y: 57, s: 150 },
]

// The volunteer's route along the streets (SVG units, 0–1000).
const ROUTE = 'M 300 905 L 300 610 L 505 610 L 505 400 L 610 400 L 610 300 L 400 300 L 400 505 L 190 505 L 190 700 L 300 700 Z'

const CARDS = [
  { icon: MapPin, color: 'text-danger', title: 'New report', text: 'Open manhole · Mirpur 10', className: 'left-4 top-5' },
  { icon: BadgeCheck, color: 'text-info', title: 'Validated', text: 'Confirmed by 6 neighbours', className: 'right-4 top-1/3 hidden sm:flex' },
  { icon: CircleCheckBig, color: 'text-brand', title: 'Fixed', text: 'Volunteer posted proof · confirmed', className: 'bottom-5 left-1/2 -translate-x-1/2 sm:left-auto sm:right-10 sm:translate-x-0' },
]

/** Decorative, animated 3D city: issue pins drop in, heat glows, a volunteer moves along the streets. */
export function CityMap3D({ className }: { className?: string }) {
  return (
    <div className={clsx('city3d card relative overflow-hidden', className ?? 'h-[340px] md:h-[420px]')} aria-hidden="true">
      <div className="city3d-viewport">
        <div className="city3d-plane">
          <svg viewBox="0 0 1000 1000" className="absolute inset-0 size-full">
            <rect width="1000" height="1000" fill="var(--map-land)" />
            {CITY.blocks.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="6"
                fill={b.park ? 'var(--map-park)' : 'var(--map-block)'} />
            ))}
            <path d="M -20 760 C 180 700 260 840 460 790 S 760 640 1020 700" fill="none"
              stroke="var(--map-water)" strokeWidth="34" strokeLinecap="round" />
            <path d="M 0 400 L 1000 400 M 505 0 L 505 1000" stroke="var(--map-major)" strokeWidth="16" />
            <path d={ROUTE} fill="none" stroke="var(--brand)" strokeWidth="5" strokeDasharray="10 12" opacity="0.55" />
          </svg>
          {/* The volunteer: moves along ROUTE with a CSS motion path (the plane is 1000 px, the same units as the SVG). */}
          <span className="city3d-volunteer" style={{ offsetPath: `path('${ROUTE}')` }} />

          {HEAT.map((h, i) => (
            <span key={i} className="city3d-heat"
              style={{ left: `${h.x}%`, top: `${h.y}%`, width: h.s, height: h.s, animationDelay: `${i * 1.3}s` }} />
          ))}

          {PINS.map((p, i) => (
            <span key={i} className="city3d-anchor" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <span className="city3d-ring" style={{ '--c': p.c, animationDelay: `${p.d + 0.6}s` } as CSSProperties} />
              <span className="city3d-pin" style={{ animationDelay: `${p.d}s` }}>
                <span className="issue-pin" style={{ background: p.c }}><span /></span>
              </span>
            </span>
          ))}
        </div>
      </div>

      {CARDS.map((c, i) => (
        <div key={c.title} className={`city3d-card card absolute flex items-center gap-2.5 px-3 py-2 shadow-lg ${c.className}`}
          style={{ animationDelay: `${i * 3}s` }}>
          <c.icon className={`size-5 shrink-0 ${c.color}`} />
          <div className="text-xs leading-tight">
            <p className="font-semibold">{c.title}</p>
            <p className="text-muted">{c.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
