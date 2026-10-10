import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'

const UPDATED = '10 October 2026'
const PROJECT_URL = 'https://github.com/aksanX/SPL_II_AmarShohor'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title)
  return (
    <article className="card mx-auto max-w-2xl space-y-4 p-6 text-sm leading-relaxed [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-xs text-muted">Last updated {UPDATED}</p>
      </header>
      {children}
      <p className="border-t border-line pt-4 text-xs text-muted">
        AmarShohor is a student software project. Questions or requests: see the contact details on the{' '}
        <a className="text-brand hover:underline" href={PROJECT_URL} target="_blank" rel="noreferrer">project page</a>.
        {' '}See also the <Link className="text-brand hover:underline" to={title === 'Terms of Use' ? '/privacy' : '/terms'}>
          {title === 'Terms of Use' ? 'Privacy Policy' : 'Terms of Use'}</Link>.
      </p>
    </article>
  )
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        AmarShohor lets residents report civic problems (potholes, garbage, broken streetlights, waterlogging),
        confirm them, and get them fixed by volunteers or the City Corporation. By creating an account you agree to
        these rules.
      </p>
      <h2>Not an emergency service</h2>
      <p>
        For fire, crime, accidents or anyone in danger, call <strong>999</strong> first. Emergency alerts in the app only
        warn neighbours; nobody is guaranteed to see them in time.
      </p>
      <h2>Report honestly</h2>
      <ul>
        <li>Report only real problems, at the place they really are, with photos you took yourself.</li>
        <li>Don't post fake, duplicate or advertising reports, and don't confirm or flag things you haven't seen.</li>
        <li>Don't photograph people's faces, car number plates or the inside of homes when you can avoid it.</li>
        <li>Describe the problem, not people. No insults, accusations against named persons, hate or threats.</li>
        <li>Stay safe. Never go closer to danger, block traffic or enter private property for a photo.</li>
      </ul>
      <h2>Moderation</h2>
      <p>
        The community can flag posts, and enough flags hide them. Admins may hide posts, remove photos, pause posting
        or reputation for accounts that break these rules, and close accounts that keep doing it. You can appeal a
        hidden report from the report itself.
      </p>
      <h2>Volunteering</h2>
      <p>
        Volunteers act on their own and at their own risk. AmarShohor does not employ volunteers or pay for work, and
        some problems (electric wires, deep drains, gas) are marked for the authorities only. Don't take a task you can't
        do safely.
      </p>
      <h2>Your content</h2>
      <p>
        You keep the rights to your photos and text. By posting them you allow AmarShohor to show them publicly on the
        app, the map and in summaries for the City Corporation, also after you delete your account (then without your
        name).
      </p>
      <h2>No guarantee</h2>
      <p>
        AmarShohor is a student project offered as it is. We do our best to keep it running and accurate, but we can't
        promise that a problem will be fixed, that the service will always be available, or that every report is correct.
      </p>
      <h2>Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version.</p>
    </LegalPage>
  )
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> email address, password (stored scrambled; we can't read it), username.</li>
        <li><strong>Profile (optional):</strong> full name, picture, bio, area.</li>
        <li><strong>Reports and activity:</strong> titles, descriptions, photos and videos, the location of each report,
          comments, votes, confirmations, flags and volunteer tasks.</li>
        <li><strong>Location:</strong> your GPS position when you report, confirm, fix or take a live photo, to check you
          are really there. Your home area, if you set one, to show nearby issues and notifications.</li>
        <li><strong>Security:</strong> a CAPTCHA check (Cloudflare Turnstile) on sign up and log in, and the usual
          technical logs of our hosting provider (such as IP addresses).</li>
      </ul>
      <h2>Who can see what</h2>
      <ul>
        <li><strong>Everyone:</strong> reports (with photos, location and status), comments, your username, profile and
          reputation. Reports posted anonymously don't show who posted them.</li>
        <li><strong>Only you:</strong> your email, home location and settings, notifications.</li>
        <li><strong>Admins:</strong> what they need to moderate, such as flags and appeals. The system still knows who
          posted an anonymous report, so limits and penalties apply to it, but other people don't see the name.</li>
        <li><strong>City Corporation officials:</strong> the reports in their area that are sent to them.</li>
      </ul>
      <p>Photo file names are random, so a photo link doesn't reveal who uploaded it. We don't sell data or show ads.</p>
      <h2>Where it is stored</h2>
      <p>
        Data is stored with Supabase (database, login and file storage). CAPTCHA checks go through Cloudflare. Maps use
        OpenStreetMap tiles, so your browser asks their servers for the map area you look at.
      </p>
      <h2>How long we keep it</h2>
      <ul>
        <li>Read notifications are deleted after 90 days, unread ones after a year.</li>
        <li>Photos that were never used in a post are deleted.</li>
        <li>Reports stay for as long as they are useful to the community and the City Corporation.</li>
      </ul>
      <h2>Deleting your account</h2>
      <p>
        Go to <Link className="text-brand hover:underline" to="/settings">Settings</Link> → Delete my account. Your
        email, name, picture, bio, area, home location, notifications and roles are removed, and you can't log in
        again. Your reports, photos, comments and votes stay so the problems you reported aren't lost, but they are no
        longer linked to your name.
      </p>
      <h2>Changes</h2>
      <p>We may update this policy. The date at the top shows the latest version.</p>
    </LegalPage>
  )
}
