# IT News Daily

`IT News Daily` is a standalone web app that aggregates current IT headlines from a curated set of RSS feeds and sends a daily digest to one or more email recipients.

## Features

- Standalone local webpage for reading the latest IT headlines
- Configurable recipient list for one or many email addresses
- Configurable SMTP settings for your own mail provider
- Built-in daily scheduler with timezone-aware send time
- Manual "send now" action for testing or ad hoc delivery
- Cached latest news digest stored locally in JSON

## Quick start

```bash
npm install
npm start
```

Then open [http://localhost:3030](http://localhost:3030).

## Configuration

All runtime settings are stored in `data/config.json` after you save them from the web UI.

You will need:

- SMTP host
- SMTP port
- SMTP username
- SMTP password
- From email address
- One or more recipient emails

## News sources

The app currently combines feeds from:

- Microsoft News
- Google Cloud Blog
- AWS News Blog
- Cisco Blogs
- The Hacker News
- Krebs on Security
- Ars Technica
- TechCrunch
- The Verge
- MIT Technology Review

## Publishing to GitHub

After initializing git:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Notes

- This app is intentionally simple and self-hosted.
- SMTP credentials are stored locally in `data/config.json`.
- For production internet deployment, add proper secrets handling and authentication.
