# VPN Probe

A web-based client-side network diagnostics tool designed to check internet censorship, DNS poisoning, DPI blocking, throttling, and the viability of common VPN transport protocols. 

Runs entirely in the browser without any installation, backend dependencies, or sign-ups.

**Live Demo:** [https://milkycloud-dev.github.io/vpn-probe/](https://milkycloud-dev.github.io/vpn-probe/)

---

## Features

* **Network Baseline Checks:** Performs HTTPS probes to major global CDNs (Cloudflare, Google, GitHub, etc.).
* **Censorship Detection:** Tests reachability of popular blocked services.
* **DNS Diagnostics:** Resolves queries against DoH resolvers, checks for poisoned records, and compares IPv4 vs IPv6.
* **Transport Protocol Probes:** Assesses WebSocket (WSS) stability, UDP/STUN reachability, and WebTransport performance to approximate the viability of VPN protocols (VLESS, VMess, Trojan, Shadowsocks, WireGuard, Hysteria, Reality).
* **Detailed Logs:** Offers downloadable raw logs and clipboards export after scanning.

---

## Technical Stack

* **Frontend:** Vite, TypeScript, HSL Tailored CSS (Vanilla UI).
* **CI/CD & Hosting:** GitHub Actions & GitHub Pages.

---

## Developer Guide

### Getting Started

1. Clone the repository and install packages:
   ```bash
   git clone https://github.com/milkycloud-dev/vpn-probe.git
   cd vpn-probe
   npm install
   ```

2. Start the local development server:
   ```bash
   npm run dev
   ```

3. Build production bundle:
   ```bash
   npm run build
   ```

---

## Deployment

Deploy your own instance of VPN Probe using GitHub Pages:

1. Fork or clone the repository.
2. In your repository settings: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to the `main` or `master` branch. The included GitHub Actions workflow will build and publish the site automatically.

---

## License

This project is licensed under the **MIT License**.
