import clsx from 'clsx'
import type { HexCell } from '@/models'
import { formatDistance } from '@/shared/geo/distance'
import { HEAT_LEGEND_CSS } from '@/features/map/lib/heat'
import { formatBreak, HEX_COLORS, hexBreaks, hexMaxWeight } from '@/features/map/lib/hexGrid'

/** The hexagon legend: the colour scale, the hottest hexagon and the colour limits. Hidden on phones under a panel. */
export function HexLegend({ cells, cellM, hideOnPhone }: { cells: HexCell[]; cellM: number; hideOnPhone: boolean }) {
  return (
    <div className={clsx('card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg', hideOnPhone && 'hidden md:block')}>
      <p className="mb-1.5 font-semibold">Heat score per hexagon ({formatDistance(cellM)} sides)</p>
      <div className="flex">
        {HEX_COLORS.map((c) => <span key={c} className="h-3 w-9" style={{ background: c }} />)}
      </div>
      <div className="flex justify-between text-muted">
        <span>low</span>
        <span>{hexMaxWeight(cells).toFixed(1)}</span>
      </div>
      <p className="mt-1 text-muted">Breaks: {hexBreaks(cells).map(formatBreak).join(' · ')}</p>
    </div>
  )
}

/** The heat legend: the same colours as the heat layer, low to high. */
export function HeatLegend({ hideOnPhone }: { hideOnPhone: boolean }) {
  return (
    <div className={clsx('card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg', hideOnPhone && 'hidden md:block')}>
      <p className="mb-1.5 font-semibold">Issue intensity</p>
      <div className="h-3 w-44 rounded" style={{ background: HEAT_LEGEND_CSS }} />
      <div className="flex justify-between text-muted"><span>low</span><span>high</span></div>
    </div>
  )
}
