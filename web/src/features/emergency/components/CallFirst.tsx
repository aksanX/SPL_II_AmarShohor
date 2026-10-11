import { Phone, Siren } from 'lucide-react'
import type { EmergencyContact } from '@/models'

/** 999 first, always. Shown as text because phone links don't work everywhere. */
export function CallFirst({ contacts, area }: { contacts?: EmergencyContact[]; area?: string | null }) {
  return (
    <div className="space-y-3 rounded-xl bg-danger p-4 text-danger-ink">
      <p className="flex items-center gap-2 text-lg font-bold"><Siren className="size-6" /> Call first</p>
      <a href="tel:999" className="flex items-center justify-between rounded-lg bg-white/15 p-3 hover:bg-white/25">
        <span>National emergency (police, fire, ambulance)</span>
        <span className="flex items-center gap-2 text-2xl font-extrabold tabular-nums"><Phone className="size-5" /> 999</span>
      </a>
      {contacts && contacts.length > 0 && (
        <div className="space-y-1">
          {area && <p className="text-xs opacity-80">Local numbers for {area}</p>}
          {contacts.map((c) => (
            <a key={c.label + c.phone} href={`tel:${c.phone}`} className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
              <span>{c.label}</span><span className="select-all font-bold tabular-nums">{c.phone}</span>
            </a>
          ))}
        </div>
      )}
      <p className="text-sm opacity-90">
        AmarShohor is not an emergency service and does not contact the fire service or police. It only warns people nearby.
      </p>
    </div>
  )
}
