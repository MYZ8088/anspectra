# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Aloom, please **do not open a public GitHub issue**.

Instead, use the repository's private GitHub Security Advisory form with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact

You will receive a response within 72 hours. Once the issue is confirmed and a fix is ready, a public disclosure will be made.

## Scope

- **In scope:** vulnerabilities in the web app, agent, or any code in this repo
- **Out of scope:** vulnerabilities in third-party dependencies (report those upstream)

## Notes on Auth

Aloom stores provider auth sessions only on the local collector machine. Browser profiles, cookies, and local storage are never uploaded to the control plane. Captured answer text and configured evidence are sent directly from your infrastructure to the selected analysis provider, which defaults to AIHubMix.
