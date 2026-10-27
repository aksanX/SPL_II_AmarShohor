import { Link } from 'react-router-dom'
import { LegalPage } from '@/features/legal/components/LegalPage'

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
