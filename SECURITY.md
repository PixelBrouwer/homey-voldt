# Security and sanitization

This public repository contains source code and synthetic test fixtures. It does not contain real Voldt account credentials, device local keys, Homey access tokens, account sessions, personal network configuration, OEM app signing secrets, APKs or research dumps.

## Private build configuration

The configured production build uses shared OEM app integration/signing material. That material is omitted from this public source. Only an empty `lib/voldt-app-identity.example.json` template is provided; `lib/voldt-app-identity.json` is ignored by Git. Never commit a populated file, include it in a public source release, or paste it into an issue. The same applies to `env.json`, `.env` files, device keys and account/session exports.

The unconfigured source loads normally. Account login returns an explicit configuration error until the private OEM file has been supplied separately. The source snapshot's version remains 1.0.0; this private-configuration boundary is the documented sanitization change from the submitted build. This does not change the charging protocol or device commands.

## Credentials at runtime

In a configured build the Voldt password is used only to authenticate and is not persisted. Temporary onboarding sessions expire; frontend responses do not include device keys. A verified local device key is retained in Homey's device storage for daily LAN control. Treat Homey backups and diagnostic exports as private.

Synthetic tests deliberately use recognizable example keys, dummy account tokens and locally generated RSA keys. These are not usable credentials. Public LAN discovery constants are protocol constants, not device-specific keys.

## Reporting

Do not attach credentials, raw account responses, populated OEM configuration, Homey backups or full device configuration to a public issue. For a sensitive report, contact the maintainer through [their GitHub profile](https://github.com/PixelBrouwer) and agree on a private channel first. Normal bug reports should describe model, firmware, app version and a redacted error message.
