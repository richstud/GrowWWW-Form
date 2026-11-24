# GrowWWW-form

A 10-second lead form. The visitor:
1. **taps their problem** (8 options covering Software Development, Automation, Digital Marketing, Trading Software, Other),
2. enters **name + WhatsApp + best time to call** (budget optional) → instant Telegram alert,
3. can **optionally add details** (problem, company, city, email, timeline) → second Telegram alert, same Sheet row updated.

If they try to leave first (mouse leaves the window on desktop, or the first Back press on mobile), a
**"Get a FREE call back"** popup asks only for their number + best time. It sends **only when they tap "Call me back"**.

```
public/index.html                     ← the form; edit CONFIG near the bottom
public/_redirects                     ← /algo /development /automation /marketing links (highlight that issue)
supabase/functions/submit-growth-lead ← backend (deployed to Supabase)
google-apps-script/GrowthLeads.gs     ← add-on for your existing Google Sheet script
netlify.toml                          ← Netlify settings (publish = public)
```

## Where each lead goes
- **Supabase**: table `growth_form_leads` (separate from website enquiries)
- **Telegram**: same chat as website enquiries, titled e.g. "🔥 Hot SOFTWARE AUTOMATION LEAD"
- **Google Sheet**: same Sheet, one tab per service (*Algo / Development / Automation / Marketing / General Leads*) plus *Callback Requests*
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
