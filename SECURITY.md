# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities using GitHub's private security
advisory feature. Do not include API keys, personal library data, filesystem
paths, or media in a public issue.

Include the affected version, platform, reproduction steps, and expected impact.
You should receive an acknowledgement within seven days.

## Security model

- The Electron renderer is sandboxed with context isolation enabled.
- Privileged renderer requests are revalidated by the main process.
- Kinoir Air is opt-in, paired, and read-only for remote devices.
- Air is for a trusted private LAN and must not be exposed directly to the
  public internet.
- Optional tools execute locally and are not required for the core app.

Only the latest released version receives security fixes during public beta.
