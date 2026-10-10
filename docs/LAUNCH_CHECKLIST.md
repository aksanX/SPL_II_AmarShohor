# Before real users join

Settings in the Supabase dashboard and Cloudflare. Nothing here changes code. Do them in order, on the **SPL-II(AmarShohor)** project (check the name at the top left).

## 1. Turn demo mode off
SQL Editor:
```sql
update app_settings set new_account_hours = 24, established_account_hours = 168, volunteer_min_account_hours = 72;
```

## 2. An email service (SMTP)
Supabase's built-in email is only for testing: it sends **only to the project's own team members** and just a few emails an hour. Real people would never get their confirmation or password-reset email. Connect a free email service first.

**a. Pick one.**
- **Brevo** (free, 300 emails a day). Works without your own domain: sign up at brevo.com, then **Senders, Domains & Dedicated IPs → Senders → Add a sender** and verify an address you own.
- **Resend** (free, 100 a day). Needs a domain you control (add the DNS records it shows). Better delivery, less spam folder.

Without your own domain, emails "from" a Gmail address often land in spam. For the demo that's fine; tell testers to check spam.

**b. Get the SMTP details.**
| | Brevo | Resend |
|---|---|---|
| Host | `smtp-relay.brevo.com` | `smtp.resend.com` |
| Port | `587` | `465` |
| Username | the SMTP login shown under **SMTP & API → SMTP** | `resend` |
| Password | an **SMTP key** created on the same page | an **API key** |

**c. Put them in Supabase.** Authentication → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**. Fill in host, port, username, password, **Sender email** (the verified address) and **Sender name** `AmarShohor`. Save.

**d. Allow more emails.** Authentication → **Rate Limits** → **Emails sent per hour**: raise it from the default to about `100` (stay under your provider's daily limit).

**e. Test.** Sign up in the app with an address that isn't on the Supabase team, and use **Forgot password?** once. Both emails should arrive within a minute (check spam). The SMTP password is a secret: never put it in the code, `.env` files or chats.

## 3. Stop scripted fake accounts
New accounts count less for a week, but a patient attacker can still create hundreds of accounts and wait. These three settings make that much harder.

**a. Email confirmation.** Authentication → Sign In / Providers → Email → turn **Confirm email** on. A fake account then needs a real inbox. Do section 2 first, or nobody can finish signing up.

**b. Minimum password length.** Same page → **Minimum password length: 8**. The app already asks for 8; this makes the server enforce it too.

**c. CAPTCHA (Cloudflare Turnstile, free).**
1. dash.cloudflare.com → **Turnstile** → **Add site**. Domain: your deployed address (and `localhost` for testing). Widget mode: **Managed**.
2. Copy the **site key** into `web/.env.local` (and into your hosting's environment variables):
   `VITE_TURNSTILE_SITE_KEY=0x4AAAA...`
3. Supabase → Authentication → **Bot and Abuse Protection** → enable CAPTCHA → provider **Turnstile** → paste the **secret key**.
4. Restart the app and check that a "not a robot" box appears on the login card, and that logging in still works.

Do steps 2 and 3 together: if only Supabase has CAPTCHA on, nobody can log in; if only the app has the key, the box shows but isn't checked.

## 4. Addresses
Authentication → URL Configuration: set **Site URL** to the deployed address and add `https://<your-address>/**` to the redirect URLs, so confirmation and password-reset emails link to the right place.

## 5. Keys
If the **secret** (service_role) key was ever pasted in a chat, a document or a commit: Project Settings → API Keys → create a new secret key and delete the old one. The app only uses the **publishable** key.

## 6. Storage space
The free plan has 1 GB for photos and videos (a 30-second video can be 25 MB). Admin → Settings → **Unused uploads** shows files nobody uses and deletes them. Check it monthly, and Project → Usage for the total.

## 7. Backups
Follow `docs/BACKUPS.md` before launch, and then weekly.

## 8. Live photos on, policies read
- If live photos were turned off for a laptop demo, turn them back on, so fixes and "I see this too" can't use old gallery photos:
  ```sql
  update app_settings set live_issue_evidence = true;
  ```
- Read `/terms` and `/privacy` in the app with your supervisor. Put a real contact (team email) on the project's GitHub page; both pages point there for questions and data requests.
