import {
  ArrowRight, Camera, CircleCheckBig, Flame, HandHelping, ShieldCheck, Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthForm, type AuthMode } from '../components/AuthForm'
import { CityMap3D } from '../components/CityMap3D'
import { ThemeToggle } from '../components/ThemeToggle'

const FEATURES = [
  { icon: Camera, title: 'Report with photo & location', text: 'Snap a photo, search or pin the exact spot, and post it in under a minute.' },
  { icon: Users, title: 'Community validation', text: 'Neighbours upvote and confirm issues on site, so real problems rise and fake ones get hidden.' },
  { icon: HandHelping, title: 'Volunteer fixes', text: 'Volunteers take on validated issues, fix them or escalate them to the authority, and post proof.' },
  { icon: Flame, title: 'Live heatmap', text: 'See which areas have the most unresolved problems, and how hot any place you search is.' },
  { icon: CircleCheckBig, title: 'Confirmed fixes', text: 'A fix only counts once the reporter or neighbours confirm it. If it isn’t fixed, it reopens.' },
  { icon: ShieldCheck, title: 'Fair by design', text: 'No admins or gatekeepers: votes are weighted by distance and account age, so nobody can game it.' },
]

/**
 * The one page for visitors who aren't logged in: what AmarShohor is, plus log in / sign up on the side.
 * Also shown at /login (when a page needs an account): `startMode` 'login' opens that tab and moves to it, and
 * `redirectTo` is where logging in leads back to.
 */
export function LandingPage({ startMode = 'register', redirectTo = '/' }: { startMode?: AuthMode; redirectTo?: string }) {
  const [mode, setMode] = useState<AuthMode>(startMode)
  const mobileAuthRef = useRef<HTMLDivElement>(null)
  const sideAuthRef = useRef<HTMLDivElement>(null)

  // On wide screens the card is always visible beside the page, so focus its first field; on phones it sits
  // below the hero, so scroll to it first.
  const showCard = () => {
    const wide = window.matchMedia('(min-width: 1024px)').matches
    const card = (wide ? sideAuthRef : mobileAuthRef).current
    if (!wide) card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Wait for a tab switch to render (the sign-up tab adds fields), and on phones for the scroll to land.
    setTimeout(() => card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), wide ? 0 : 400)
  }

  // "Report a problem" / "Create a free account" switch the card's tab.
  const openAuth = (m: AuthMode) => {
    setMode(m)
    showCard()
  }

  // Sent here to log in: go straight to the card.
  useEffect(() => {
    if (startMode === 'login') showCard()
  }, [startMode])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-[1000] border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-9" />
            <span className="text-xl font-extrabold tracking-tight text-brand">AmarShohor</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 pt-4 lg:grid-cols-[1fr_380px] lg:pb-16 lg:pt-6">
        <div className="min-w-0 space-y-14">
          {/* Hero: the animated city as a banner, the headline and call to action right under it. */}
          <section className="space-y-6">
            {/* Sized to the screen height so the banner and the whole title fit on the first screen. */}
            <CityMap3D className="h-[clamp(190px,30vh,300px)]" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand">আমার শহর · My City</p>
              <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
                Fix your neighbourhood, <span className="text-brand">together.</span>
              </h1>
              <p className="mt-4 max-w-xl text-lg text-muted">
                A city is only as strong as its neighbours. Join a community of people who care about the places we share,
                and help shape the city we all call home.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button className="btn-primary px-5 py-3 text-base" onClick={() => openAuth('register')}>
                  Report a problem <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          </section>

          {/* On phones the sign-up card comes right after the hero; on wide screens it sits in the side column. */}
          <div className="lg:hidden" ref={mobileAuthRef}>
            <AuthForm mode={mode} onModeChange={setMode} redirectTo={redirectTo} />
          </div>

          <section>
            <h2 className="text-2xl font-bold">Main features</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="card p-4">
                  <f.icon className="size-6 text-brand" />
                  <p className="mt-2 font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="card flex flex-col items-start gap-4 bg-brand-soft p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Seen a problem on your street?</h2>
              <p className="mt-1 text-sm text-muted">Join your neighbours and get it on the map today.</p>
            </div>
            <button className="btn-primary shrink-0 px-5 py-3 text-base" onClick={() => openAuth('register')}>
              Create a free account <ArrowRight className="size-4" />
            </button>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-[4.5rem] space-y-3" ref={sideAuthRef}>
            <div>
              <h2 className="text-lg font-bold">{mode === 'login' ? 'Welcome back' : 'Join your neighbours'}</h2>
              {mode === 'login' && <p className="text-sm text-muted">Log in to report, vote and volunteer.</p>}
            </div>
            <AuthForm mode={mode} onModeChange={setMode} redirectTo={redirectTo} />
          </div>
        </aside>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        AmarShohor · a community civic platform for Bangladesh · Map data © OpenStreetMap contributors
        <span className="mt-1 block">
          <Link className="hover:underline" to="/terms">Terms of Use</Link> · <Link className="hover:underline" to="/privacy">Privacy Policy</Link>
        </span>
      </footer>
    </div>
  )
}
