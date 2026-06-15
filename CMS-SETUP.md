# Setting up the no-code editor (for your mom)

The editor lives at **`/admin/`** and is built with **Decap CMS**. Once it's set up, your
mom logs in on a web page, fills out simple forms to add/edit products and workshops, clicks
**Publish**, and the site updates on its own — no downloads, no terminal, no GitHub account.

## Why the site has to move to Netlify (free)

The editor needs a login system. The free, mom-friendly way (email + password, no GitHub
account) is **Netlify Identity**, which only works when the site is **hosted on Netlify**.
Netlify is free and deploys straight from this same GitHub repo.

**Tradeoff:** the public address becomes a `something.netlify.app` link instead of
`jacklittle4.github.io/...`. You can rename it to anything available (e.g.
`epiclittletreasures.netlify.app`) for free, or add a custom domain later. The GitHub Pages
URL keeps working too, but the editor login only works on the Netlify copy — so share the
Netlify link going forward.

## One-time setup (about 15 minutes, all clicking — no terminal)

1. **Merge this branch first** so `admin/` is on `main`.
2. Go to **app.netlify.com** → sign up (free) with your GitHub account.
3. **Add new site → Import an existing project → GitHub →** pick `epiclittletreasures`.
   - Build command: leave **blank**. Publish directory: **`/`** (or leave blank). Click Deploy.
4. Your site is now live at a `*.netlify.app` URL (rename it under **Site configuration → Change site name**).
5. **Site configuration → Identity → Enable Identity.**
6. Under Identity → **Registration preferences**, choose **Invite only**.
7. Under Identity → **Services → Git Gateway → Enable.**
8. Identity → **Invite users** → invite your mom's email (and your own). She gets an email,
   clicks it, and sets a password.
9. Tell your mom to go to **`<your-netlify-url>/admin/`**, log in, and she'll see
   **Products** and **Workshops** with simple forms. Edit → **Publish** → the site updates
   in a minute or two.

## Notes
- Photos: in a product form, click the **Photo** field to upload from her computer — it saves
  into `assets/` automatically.
- The **ID** field auto-fills from the name; she can leave it blank on new items.
- The old `manager.html` tool is no longer needed once this is set up (you can delete it).
- If you ever want to stay on GitHub Pages instead, the editor would require a GitHub login
  for her plus an OAuth proxy — more setup and less friendly, so Netlify is the recommended path.
