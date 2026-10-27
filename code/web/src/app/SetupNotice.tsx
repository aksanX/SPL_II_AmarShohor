
export function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="card space-y-3 p-6">
        <h1 className="text-xl font-bold">Connect AmarShohor to Supabase</h1>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Create a project at supabase.com and run the SQL files in <code>code/supabase/migrations</code> (see README).</li>
          <li>Copy <code>code/web/.env.example</code> to <code>code/web/.env.local</code>.</li>
          <li>Paste your Project URL and anon key from Project Settings → API.</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
      </div>
    </div>
  )
}
