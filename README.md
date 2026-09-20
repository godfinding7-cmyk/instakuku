# InstaKuku V2

A public Instagram Reel downloader UI inspired by editorial/3D creative-agency sites: full-screen canvas artwork, minimal floating navigation and a bottom glass downloader dock.

## Render deployment

1. Put the files in the repository root so `Dockerfile`, `server.js`, `package.json` and `public/` are visible immediately.
2. Render → New Web Service → Runtime: Docker.
3. Branch: main. Root Directory: blank if the files are in repo root.
4. Free plan can be used for testing.
5. Health Check Path: `/api/health`.
6. Deploy.

The Docker image installs current `yt-dlp` with the `curl_cffi` impersonation dependency plus ffmpeg. The backend tries a browser-like request first and then a standard yt-dlp request.

## Important Instagram limitation

Instagram may block or rate-limit cloud-hosting IP addresses even for a public Reel. The frontend now distinguishes this upstream block from an invalid URL/private Reel. No code can guarantee anonymous extraction indefinitely because Instagram changes anti-bot behavior.

## Before AdSense

Replace `https://example.com` in canonical/sitemap/robots files with your real domain and replace the placeholder `ads.txt` content with your own publisher ID after AdSense provides it. Review all policy/contact copy for your real business details.
