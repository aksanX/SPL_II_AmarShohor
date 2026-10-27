import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '@/shared/hooks/useTitle'

const UPDATED = '10 October 2026'

const PROJECT_URL = 'https://github.com/aksanX/SPL_II_AmarShohor'

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
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
