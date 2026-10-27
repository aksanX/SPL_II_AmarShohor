import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Modal } from '@/shared/ui'

/** "How is the heat calculated?": which issues count, how each issue's heat is worked out, and the three map views. */
export function HeatmapHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppSettings().data
  return (
    <Modal open={open} onClose={onClose} title="How the heatmap works">
      <div className="space-y-3 text-sm">
        <p><strong>Which issues count:</strong> only issues the community has <em>validated</em> and that are not fixed yet
          (validated, assigned, in progress, fix awaiting confirmation). Unverified posts, hidden fakes and resolved issues are excluded,
          so the map shows real, current problems.</p>
        <p><strong>Time filter:</strong> "Last 7 days" or "Last 30 days" in Filters keeps only issues <em>reported</em> in that time.
          The hexagon lists and the dropped pin's summary use the same filter, so their numbers always match the map.</p>
        <p><strong>No double counting:</strong> duplicates are merged at reporting time ("I see this too"), so one pothole is one issue
          — ten people reporting it make it <em>hotter</em>, not ten dots.</p>
        <p><strong>Each issue's heat =</strong></p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Severity:</strong> low 1 · medium 2 · high 3 · critical 4 (decided by the community)</li>
          <li><strong>× Evidence:</strong> 1 + ln(1 + on-site confirmations) + 0.25 × ln(1 + upvotes)</li>
          <li><strong>× Freshness:</strong> halves every {settings?.heat_half_life_days ?? 30} days since validation, but never below 35% —
            an old unfixed problem is still a problem.</li>
        </ul>
        <p><strong>Hexagons</strong> (most accurate): each issue is placed in exactly one hexagon on a fixed grid, and the hexagon's colour
          is the sum of its issues' heat. Hexagon size adapts to zoom and is corrected for map projection, so a 220 m hexagon is
          really 220 m on the ground in Dhaka.</p>
        <p><strong>Heat</strong> is a smooth blur of the same weighted points — nicer looking but less precise. <strong>Pins</strong> show
          individual issues, clustered when zoomed out.</p>
        <p><strong>Location accuracy:</strong> GPS pins worse than ±{settings?.max_gps_accuracy_m ?? 100} m are rejected unless the reporter
          places the pin by hand, and pins outside Bangladesh are refused.</p>
      </div>
    </Modal>
  )
}
