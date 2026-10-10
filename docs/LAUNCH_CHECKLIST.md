# Before real users join

Settings in the Supabase dashboard and Cloudflare. Nothing here changes code. Do them in order, on the **SPL-II(AmarShohor)** project (check the name at the top left).

## 1. Turn demo mode off
SQL Editor:
```sql
update app_settings set new_account_hours = 24, established_account_hours = 168, volunteer_min_account_hours = 72;
```

## 2. Stop scripted fake accounts
New accounts count less for a week, but a patient attacker can still create hundreds of accounts and wait. These three settings make that much harder.

**a. Email confirmation.** Authentication → Sign In / Providers → Email → turn **Confirm email** on. A fake account then needs a real inbox.

**b. Minimum password length.** Same page → **Minimum password length: 8**. The app already asks for 8; this makes the server enforce it too.

**c. CAPTCHA (Cloudflare Turnstile, free).**
1. dash.cloudflare.com → **Turnstile** → **Add site**. Domain: your deployed address (and `localhost` for testing). Widget mode: **Managed**.
2. Copy the **site key** into `web/.env.local` (and into your hosting's environment variables):
   `VITE_TURNSTILE_SITE_KEY=0x4AAAA...`
3. Supabase → Authentication → **Bot and Abuse Protection** → enable CAPTCHA → provider **Turnstile** → paste the **secret key**.
4. Restart the app and check that a "not a robot" box appears on the login card, and that logging in still works.

Do steps 2 and 3 together: if only Supabase has CAPTCHA on, nobody can log in; if only the app has the key, the box shows but isn't checked.

## 3. Addresses
Authentication → URL Configuration: set **Site URL** to the deployed address and add `https://<your-address>/**` to the redirect URLs, so confirmation and password-reset emails link to the right place.

## 4. Keys
If the **secret** (service_role) key was ever pasted in a chat, a document or a commit: Project Settings → API Keys → create a new secret key and delete the old one. The app only uses the **publishable** key.

## 5. Storage space
The free plan has 1 GB for photos and videos (a 30-second video can be 25 MB). Admin → Settings → **Unused uploads** shows files nobody uses and deletes them. Check it monthly, and Project → Usage for the total.

## 6. Backups
Follow `docs/BACKUPS.md` before launch, and then weekly.
