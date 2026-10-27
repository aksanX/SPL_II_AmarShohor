import { LegalPage } from '@/features/legal/components/LegalPage'

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
