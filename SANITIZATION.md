# Version 1.0.0 public-source audit

Only the standalone Homey app, documentation and synthetic automated tests are exported. The research workspace and its history are not published.

Removed/excluded:

- Real Voldt account/device credentials, local keys and sessions.
- Homey access tokens and personal device/network identifiers.
- OEM app identity/signing material; only an empty private-configuration template remains.
- APKs, extracted vendor binaries, research dumps, live results and local filesystem paths.
- Private configuration, environment files, build output and dependency caches.

The source tree was scanned against known private credential/identifier values and their hexadecimal/base64 representations, as well as personal paths/network data and access-token patterns. No matches were found. Synthetic cryptographic vectors are intentional test fixtures, not real credentials. The fixed UDP discovery key is public protocol data, not a device local key.

The original technical app ID `nl.bryan.voldt` is retained so installed devices and Flows remain compatible. Public attribution is PixelBrouwer. No private Homey build is changed by publishing this repository.

The public snapshot contains 67 passing automated tests and passes Homey's publish-level validation. It omits four tests for a separate research-only PC service and adds one test ensuring startup succeeds without private OEM configuration. See SECURITY.md for the consequence for account login in self-built versions.
