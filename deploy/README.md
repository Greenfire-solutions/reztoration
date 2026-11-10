# Hosting Reztoration for free on Oracle Cloud

Oracle's "Always Free" tier includes an ARM machine (up to 4 cores, 24 GB memory) at no cost.
Reztoration uses about 270 MB of memory, so the smallest shape is plenty.

What is public: everything in this repository. What is never public: Native Land's homeland outlines
(their Data Sovereignty Treaty forbids hosting them without written permission). The setup script
refuses to run if they are present, and the map opens without them.

## 1. Make the account (you do this)

Sign up at https://signup.cloud.oracle.com. Oracle asks for a card to confirm you are a person; Always
Free resources are not charged. Pick a home region close to most visitors (it cannot be changed later).

**Recommended:** after signing up, upgrade the account to "Pay As You Go" (Billing > Upgrade). It stays
free inside the Always Free limits, and it stops Oracle from reclaiming an Always Free machine that
looks idle, which a small site like this one does most of the week.

## 2. Make the machine

Compute > Instances > Create instance:

- Image: **Canonical Ubuntu 24.04**
- Shape: **VM.Standard.A1.Flex** (Ampere ARM), 1 OCPU, 6 GB memory. If the region says it is out of
  capacity, try another availability domain, or use **VM.Standard.E2.1.Micro** (also free, 1 GB; enough).
- Networking: keep "Assign a public IPv4 address" on.
- SSH keys: "Paste public key", and paste the contents of `~/.ssh/reztoration_oracle.pub`.

Note the machine's **public IP address** when it is running.

## 3. Open the web ports in Oracle's network

Instance page > the subnet link > the Default Security List > Add Ingress Rules, two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

(Port 22 for SSH is already open.)

## 4. Install

From this Mac:

    ssh -i ~/.ssh/reztoration_oracle ubuntu@<public-ip>
    curl -fsSL https://raw.githubusercontent.com/Greenfire-solutions/reztoration/main/deploy/setup.sh -o setup.sh
    bash setup.sh

It prints the address, `https://<ip-with-dashes>.sslip.io`, with a real HTTPS certificate. To use your
own name instead (for example `reztoration.greenfire.earth`), add a DNS **A record** for that name pointing
at the public IP, wait for it to resolve, then run `bash setup.sh reztoration.greenfire.earth`.

## Updating

Push to GitHub from the Mac, then on the server:

    bash /opt/reztoration/deploy/update.sh

## What runs where

- `reztoration.service` (systemd): `node server.mjs` as the no-login user `rez`, on 127.0.0.1:8600 only,
  restarted if it stops, started on boot. It can read its own folder and nothing else.
  `REZ_NO_HOMELANDS=1`, `REZ_BEHIND_PROXY=1`, and `REZ_API_PER_MIN=600` (per visitor; a visitor past it
  gets "try again in a minute").
- Caddy: HTTPS (certificates renew themselves), compression, security headers, passes requests to the app.
- Logs: `journalctl -u reztoration -f` and `journalctl -u caddy -f`.
