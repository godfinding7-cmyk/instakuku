# InstaKuku Reel Downloader

Premium, responsive Instagram public-Reel downloader starter with original guide content, legal pages, SEO files and a Node/Express backend.

## What is included
- Animated premium homepage inspired by the supplied reference video's soft futuristic visual language.
- Public Instagram Reel URL validation.
- `/api/analyze` for metadata and available progressive formats.
- `/api/download` for temporary server-side downloads.
- Helmet security headers and 40 requests/hour API rate limit.
- About, Contact, Privacy, Terms, Disclaimer and Copyright pages.
- Three original educational articles plus a guide index.
- robots.txt, sitemap.xml, ads.txt placeholder, FAQ schema and Article schema.

## Requirements
- Node.js 20+
- `yt-dlp` installed on the server and available in PATH
- `ffmpeg` recommended for broader media compatibility

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Before publishing
1. Replace every `https://example.com` with your real domain.
2. Replace placeholder contact emails.
3. Review Privacy/Terms/Copyright text for your jurisdiction and actual data practices.
4. Install/update yt-dlp on the host.
5. Add your AdSense code only after approval, and replace ads.txt with the exact line from AdSense.
6. Add a CMP/cookie consent solution where legally required once advertising/analytics are enabled.

## Important
This project intentionally supports public Reel URLs only. It does not implement Instagram login cookies or private-media bypasses. Users should download only media they own or are authorized to save.

Policy pages and articles improve site completeness but do not guarantee AdSense approval.

## Recommended Render deployment (Docker)
This project includes a Dockerfile so Render can install yt-dlp and ffmpeg reliably.

1. Upload the contents of this `instakuku-site` folder to a GitHub repository.
2. In Render choose New > Web Service and connect the repository.
3. Set Language/Runtime to Docker.
4. If the repository root directly contains Dockerfile, leave Dockerfile Path at `./Dockerfile`.
5. Create the web service.
6. After deploy, test `/api/health`, then test one public Instagram Reel from the homepage.
