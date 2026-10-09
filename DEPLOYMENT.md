# Autody VPS deployment

Production runs on `199.192.23.71` for `autodytraded.com` and `www.autodytraded.com`.

The VPS checks GitHub `main` once per minute through `autody-sync.timer`. Each new commit is installed in a separate release directory, checked for JavaScript syntax, and started through the existing PM2 `autody` process. A deployment succeeds only after `/api/db/status` confirms a working Supabase connection. Failed startup checks return the application symlink to the previous release.

Runtime secrets, the deposit seed, local data, and `orders.json` live in `/var/lib/autody/shared`. Every release links to those same files. They are never replaced by GitHub's sample data. Releases and local snapshots retain the ten most recent entries. The initial recovery backup is kept separately under `/root/autody-recovery-*`.

GitHub's Deploy VPS workflow verifies that its commit reached the server and that Supabase is connected. It uses the server's HTTPS endpoint and requires no VPS password or SSH key in GitHub.

Useful commands on the VPS:

```bash
systemctl status autody-sync.timer
journalctl -u autody-sync.service -n 80 --no-pager
systemctl start autody-sync.service
cat /var/lib/autody/current-commit
pm2 status
curl --fail http://127.0.0.1:3000/api/db/status
```

To roll back manually, stop the timer, point `/var/www/autody-2.0` to a retained directory in `/var/www/autody-releases`, then restart PM2. Resolve the bad commit on GitHub before enabling the timer again. Supabase data and schema are shared across releases; application rollback does not reverse database schema changes.

DNS A records for `@` and any directly configured `www` or `server1` host must use the new IP. A `www` CNAME to `autodytraded.com` also works. Preserve the existing MX and email TXT records. Certbot renews the existing HTTPS certificate through its system timer.
