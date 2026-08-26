# Akshayam FP&A — Production Deployment

A single Lightsail box running everything: Next.js under PM2, PostgreSQL on the
same instance, nginx in front. Modelled on `unmaze-ops/infrastructure`.

## What is running

| | |
|---|---|
| Region / AZ | `ap-south-1` / `ap-south-1b` |
| CFN stack | `akshayam-prod` |
| Instance | `akshayam-prod` — Lightsail `nano_2_1`, 512 MB RAM, 1 vCPU, 20 GB SSD, Ubuntu 22.04 |
| Public IP | **15.206.195.223** — *dynamic*: survives reboot, changes on stop/start |
| App | Next.js 16 via PM2 (`akshayam`) on `127.0.0.1:3000` |
| Database | PostgreSQL 14 on-box — db `akshayam`, role `akshayam` |
| URL | **https://akshayam.artham.app** |
| Web server | nginx :443 → :3000, with :80 301-redirecting to :443 |
| TLS | Let's Encrypt, `CN=akshayam.artham.app`, expires 2026-11-24, auto-renewed by `certbot.timer` |
| Access gate | **none** — the site is open to anyone with the URL |
| Uploads | `/var/lib/akshayam/uploads` — outside the git tree, so `git pull` never wipes them |
| Backups | `/etc/cron.daily/akshayam-db-backup` → `/var/backups/akshayam/`, 7-day retention |
| Swap | 4 GB (`/swapfile`), `vm.swappiness=20` |

Credentials live in `infrastructure/params/prod.json`, which is **gitignored**.
That file is the only copy — back it up somewhere safe.

## Why 512 MB needs care

`next build` wants roughly 1 GB. The bootstrap therefore:

- creates the 4 GB swapfile **before** anything else runs;
- caps V8 at 1 GB during `npm ci` / `npm run build` (`NODE_OPTIONS=--max-old-space-size=1024`)
  so the build pages out to swap instead of being OOM-killed;
- trims PostgreSQL (`shared_buffers=64MB`, `max_connections=40`, …);
- runs the app itself with a 384 MB heap and `max_memory_restart: 450M`.

The first build took **5.3 minutes**. Steady state is ~105 MB for the Next.js
process against 453 MB usable, so there is real headroom — but the *build* is the
tight part. If it ever starts thrashing, either build locally and rsync `.next`,
or move `BundleId` to `micro_2_1` (1 GB).

## Deploying

### First time / rebuild from scratch

```bash
cp infrastructure/params/prod.example.json infrastructure/params/prod.json
# fill in SshPublicKey, GithubToken, DbPassword
./infrastructure/deploy.sh prod
```

The CloudFormation stack finishes in ~1 min; the on-box bootstrap runs for a
further ~10 min. Watch it:

```bash
ssh ubuntu@15.206.195.223 sudo tail -f /var/log/akshayam-bootstrap.log
```

It is done when the log prints `✅ Bootstrap complete`.

### Subsequent code deploys

```bash
ssh ubuntu@akshayam.artham.app /app/deploy.sh
```

That pulls `main`, runs `npm ci`, applies migrations, rebuilds, and restarts PM2.

## Domain and TLS

`akshayam.artham.app` has an A record (TTL 600) pointing at 15.206.195.223, and
Let's Encrypt has issued a certificate for it. nginx serves :443 and 301-redirects
:80. Renewal is handled by `certbot.timer` (enabled and active); `certbot renew
--dry-run` was run and reported all simulated renewals succeeded — nothing to do
by hand.

Certificate paths:

- `/etc/letsencrypt/live/akshayam.artham.app/fullchain.pem`
- `/etc/letsencrypt/live/akshayam.artham.app/privkey.pem`

⚠️ **The IP is dynamic.** It survives reboots, but stopping and starting the
instance assigns a new one and the A record would then point nowhere. Attach a
static IP before doing anything that stops the instance (see below).

After a rebuild from scratch, re-issue the certificate once DNS points at the new
box:

```bash
ssh ubuntu@<new-ip> sudo /app/init-ssl.sh
```

That script reads `Domain` from the stack params, so keep it set to
`akshayam.artham.app` in `params/prod.json`.

## Static IP

The Lightsail static-IP quota is **5 per region and all 5 are in use**
(`unmaze-ops-prod`, `ck-stage`, `artham-stage`, `roserve-stage`, `Ubuntu-1`), so
this stack was deployed without one. To attach one later:

1. Free an existing static IP, or raise the quota via AWS Service Quotas
   (`Lightsail` → *Static IPs*; needs a support case).
2. Set `AllocateStaticIp` to `"true"` in `params/prod.json`.
3. `./infrastructure/deploy.sh prod`

## Security posture

**The site is open.** There is no authentication of any kind: the app ships
without login, session, or middleware, and the nginx Basic Auth gate was removed
at the owner's request. Every page and every `/api/*` route is reachable by
anyone who knows the URL.

Worth knowing while it stays this way:

- Anyone who finds the URL can read the P&L, balance sheet, cash flow, and
  receivables, and can POST to `/api/upload`, which writes to the 20 GB volume.
- The hostname is in Let's Encrypt's public Certificate Transparency log, so
  `akshayam.artham.app` is discoverable without guessing.
- Traffic is encrypted now (HTTPS), so it is no longer readable in transit —
  but encryption is not authorisation: the pages are still open to all.

Fine for an experiment with test data. Put real financials behind app-level auth
first.

To put the Basic Auth gate back:

```bash
ssh ubuntu@15.206.195.223
sudo htpasswd -bc /etc/nginx/.htpasswd akshayam 'YOUR-PASSWORD'
sudo chmod 640 /etc/nginx/.htpasswd && sudo chown root:www-data /etc/nginx/.htpasswd
sudo sed -i '/location \/ {/a\        auth_basic "Akshayam";\n        auth_basic_user_file /etc/nginx/.htpasswd;' /etc/nginx/sites-available/akshayam
sudo nginx -t && sudo systemctl reload nginx
```

Then set `BasicAuthUser` / `BasicAuthPassword` in `params/prod.json` so a rebuild
keeps the gate. Leaving `BasicAuthUser` empty (the current state) means no gate.

## Operations

```bash
# app
pm2 list
pm2 logs akshayam
pm2 restart akshayam --update-env

# database
sudo -u postgres psql -d akshayam
ls -la /var/backups/akshayam/

# restore a backup
gunzip -c /var/backups/akshayam/akshayam-YYYY-MM-DD.sql.gz | sudo -u postgres psql -d akshayam

# resources — worth checking after any heavy operation
free -m
```

App environment lives in `/app/akshayam-fpa/.env.local` (mode 0600). It is read
both by `next start` and by `npm run db:migrate`.

## Teardown

```bash
aws cloudformation delete-stack --stack-name akshayam-prod --region ap-south-1
```

This destroys the instance **and the database on it**. Pull a `pg_dump` first.
