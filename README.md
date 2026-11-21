# GrowWWW-form

One lead form for four services: **Algo Trading, Software Development, Software Automation, Digital Marketing**.
The visitor picks a service from the dropdown, and the questions, offers and copy change to match.

```
public/                               ← the website (deploy this folder)
  index.html                          ← the form; edit CONFIG near the bottom
  _redirects                          ← /algo /development /automation /marketing links
  favicon.ico, apple-touch-icon.png, assets/   ← GrowWWW logo icons
netlify.toml                          ← Netlify settings (publish = public)
supabase/functions/submit-growth-lead ← backend (already deployed to Supabase)
google-apps-script/GrowthLeads.gs     ← add-on for your existing Google Sheet script
```

## Links
- `https://YOUR-SITE.netlify.app/` → opens on Algo Trading
- `/algo`, `/development`, `/automation`, `/marketing` → opens with that service selected
- Add `?utm_source=instagram` (or whatsapp, facebook, google) to track where leads come from.

## Edit before going live (`public/index.html` → `CONFIG`)
| Setting | What it is |
|---|---|
| `WHATSAPP_NUMBER` | your business WhatsApp, e.g. `919876543210` |
| `OFFER_DEADLINE` | when the draw / countdown closes, e.g. `2026-12-31T23:59:59+05:30` |
| `DRAW_PRIZE` / `DRAW_NOTE` | the lucky-draw prize and its rules. **Only promise what you will actually give.** |

## Where each lead goes
- **Supabase**: table `growth_form_leads` (separate from website enquiries)
- **Telegram**: same chat as website enquiries, titled e.g. "🔥 Hot SOFTWARE AUTOMATION LEAD"
- **Google Sheet**: same Sheet, one tab per service: *Algo Leads, Development Leads, Automation Leads, Marketing Leads*
  (needs the one-time add-on below)

## Google Sheet add-on (one time)
1. Open the Apps Script behind your website Sheet → **+ → Script** → name `GrowthLeads` → paste `google-apps-script/GrowthLeads.gs`.
2. Set `GROWTH_SECRET` to the same secret your website script uses.
3. In your existing `doPost(e)`, add as the first line inside it:
   ```js
   var growth = handleGrowthLead_(e); if (growth) return growth;
   ```
4. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.

## Deploy
**Netlify drag & drop:** sign in → app.netlify.com/drop → drop the `public` folder.
**Netlify + GitHub:** Netlify → Add new site → Import from GitHub → pick `GrowWWW-form` (settings come from `netlify.toml`).

## Testing
Opening `index.html` from your computer runs in **preview mode**: nothing is saved or sent.
Test on the live Netlify link. Then check Supabase → `growth_form_leads` → `telegram_sent` / `sheet_sent`.
