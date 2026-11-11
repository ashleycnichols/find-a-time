# Find a time

A small availability poll for your group, like When2meet. People type their name, drag across the times they're free, and the page shows which times work for the most people.

Everyone sees the times in their own time zone. The site detects each person's zone automatically, and they can change it from the menu at the top of the poll.

It's a static site: plain HTML, CSS and JavaScript, with no build step. Answers are stored in a free Supabase database.

## How it works

- **Create a poll:** pick the days, the hours, the slot length and the time zone those hours are in. You get a link to share.
- **Answer a poll:** type your name, then mark each day separately by dragging up or down that day's column, or tapping single slots. Changes save automatically. Typing the same name later lets you edit your times.
- **Group view:** the darker a time, the more people can make it. Point at or tap a time to see a pop-up of who's free and who isn't.
- **Days apart:** when the chosen days aren't next to each other (say, three weekends), a dotted break separates them in the grid.
- **Best times:** a ranked list of the time blocks the most people can make. Point at one to highlight it on the grid.
- **Finding your time zone:** type a city, country, abbreviation or offset ("Kraków", "Boston", "Ireland", "EST", "GMT+1") and pick from the matches, which show each zone's current time. If you've switched away from your own zone, a link switches you back.
- **Time zones:** every slot is stored as an exact moment in UTC. Each person's grid is laid out in their own zone, so 18:00 in Dublin shows as 13:00 in New York. If the shift crosses midnight, the grid adds the extra day.

## Set up (about 10 minutes)

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a new project. The free plan is enough. Any region works.
2. When the project is ready, open **SQL Editor**, click **New query**, paste in everything from `supabase-setup.sql`, and click **Run**. You should see "Success. No rows returned".
3. Go to **Project Settings > API** (it may be called **API Keys**) and copy two things:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon public** key, or the **publishable** key if that's what your project shows

   Don't use the `service_role` or secret key. It would give anyone full control of your database.

### 2. Set your admin password

The admin password lets you edit or delete any poll on the site, including ones other people made.

1. In **SQL Editor**, open a **New query** and paste in `supabase-admin-password.sql`.
2. Replace `PUT-YOUR-PASSWORD-HERE` with a password of your choice, keeping the quotes, and click **Run**.
3. Don't save the real password back into the file in the repo. Run the same query again any time to change it.

### 3. Add your details

Open `config.js` and fill in the two values:

```js
supabase: {
  url: "https://abcdefgh.supabase.co",
  key: "your-anon-or-publishable-key"
}
```

You can also change `siteName` to whatever you want the site to be called.

It's normal for the anon key to be in a public repo. It only allows what the rules in `supabase-setup.sql` allow.

### 4. Publish on GitHub Pages

1. Create a new repository on GitHub and upload all the files in this folder.
2. In the repository, go to **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute or so, your site is live at `https://<your-username>.github.io/<repo-name>/`.

## Editing and deleting polls

- **If you made the poll:** click **Edit poll** on the poll page. Your browser remembers that you created it, so it opens straight away. From there you can change the name, days, hours or time zone, or delete the poll.
- **On another device:** in the edit screen, click **Copy manage link** and open that link on the other device. Keep it private, since anyone with it can edit or delete the poll.
- **Any poll, as the admin:** click **Edit poll** and enter your admin password. Your browser remembers it for next time.
- **What happens to answers:** when you change the days or hours, people's answers are kept for any times still in the poll. Changing the slot length means people need to mark their times again.

## Updating an existing site

If you set up the database before the edit and delete features existed, run `supabase-setup.sql` again in the SQL Editor. It keeps your existing polls and answers. Then set an admin password as in step 2, since older polls don't have a creator key.

## Try it before setting up

If `config.js` has no Supabase details, the site runs in demo mode. Everything works, but answers are only saved in your own browser, so nobody else can see them. A yellow banner shows while you're in demo mode.

To run it on your computer, serve the folder with any local web server, for example `python3 -m http.server`, then open `http://localhost:8000`. Opening `index.html` directly from your files won't work, because browsers block the scripts.

## Things to know

- **Answers are open:** like When2meet, anyone with a poll link can see everyone's names and change any answer. Only editing or deleting the poll itself is protected. Fine for a friendly group, not for anything sensitive.
- **Updates:** the group grid refreshes every 5 seconds while the page is open.
- **Supabase free plan:** projects are paused after about a week with no activity. If the site stops loading responses, open your Supabase dashboard and restore the project. Your data is kept.
- **Limits:** a poll can have up to 2,000 time slots (for example, 6 weeks of 9:00 to 21:00 in 15-minute slots is too many, but in 30-minute slots it fits).
