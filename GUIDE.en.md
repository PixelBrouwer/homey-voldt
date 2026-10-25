# Voldt with Homey

[Overview](README.en.md) · [Dutch visual walkthrough](docs/ZO-WERKT-HET.nl.md) · [Nederlands](GUIDE.nl.md)

**Public source:** this version 1.0.0 snapshot is sanitized. Private OEM configuration is omitted; self-built versions require that configuration separately before Voldt account login works. See README.md and SECURITY.md. The steps below describe a configured build; the working production installation is unchanged.

Requires Homey Pro running Homey 12.9 or newer, a Wi-Fi Voldt cable already linked to a Voldt email/password account, and local network access between cable and Homey. Hardware tested: Homey Pro (2026), Voldt Schuko 230 V / 3.7 kW Wi-Fi cable. Homey Pro (2023) uses the same local app architecture but was not separately tested. Homey Cloud/Bridge, Bluetooth-only cables and OCPP control are not supported.

## Pair

1. Connect and verify the cable in the official Voldt app first. Reserve its IP address in your router if possible.
2. In Homey, open **Devices → Add device → Voldt → Voldt cable (local Wi-Fi)**.
3. Enter your Voldt email and password. Account country, region and optional cable IP are under account and network options. Dutch accounts normally use country **31**, region **Europe**.
4. Choose **Sign in and find cables**, select your cable, then assign its name and zone.

Homey retrieves the local key and charging schema, verifies them with a read-only LAN request, and stores the local connection on Homey. Pairing never starts or stops charging. Your password is not saved. The temporary account session expires after ten minutes; daily operation needs no account login, PC or cloud developer subscription.

## Reconnect an existing device

Open **More → Apps → Voldt → App settings**. Select your existing device, sign in, choose the found cable and select **Restore local connection**. Device identity, zone and Flows are preserved. This works even if your Homey interface has no Repair menu. Use it after an IP/key change or Wi-Fi reset.

## Charge and measure

The charging switch permits charging. Actual current depends on the car and the cable's protection and charging state. Use charging power and charging status to check actual activity. Polling defaults to 15 seconds and can be changed in advanced device settings, with a 10-second minimum.

| Sensor | Meaning |
| --- | --- |
| Charging power | Measured W; 2800 W equals 2.8 kW. |
| Total charged energy | Cable's cumulative kWh counter. |
| Charging session energy | Cable's session kWh counter, if reported. |
| Cable temperature | Controller/cable temperature in °C. |
| Current setting | Read-only current limit in A, not measured current. |
| Charging status | Connected, waiting, charging, paused, finished or fault. |

Sensors support Insights; power and cumulative energy feed Homey Energy. Missing measurements stay unknown; reported zero remains zero. The app does not synthesize kWh from power. Standard Homey charging triggers, conditions and start/stop actions are available in Flows. The charging condition follows the charging switch; add a power condition if you need to check actual energy transfer.

## Troubleshooting

If no cable is found, check your account country/region, local Wi-Fi access and optional IP. Temporarily close the official app; some cables allow only one local client. If an account session expires, sign in again. If a command result cannot be confirmed, check the cable before retrying: a potentially delivered command is never resent automatically.

Apple/Google sign-in, account registration and captcha UI are not implemented. Complete extra verification in the official app and retry; accounts that continue requiring verification cannot currently use this login route. Pairing/key retrieval depends on the reconstructed vendor mobile API, which may change. Local operation continues using the stored device key while the cable accepts it.

## Install community source

Until approved and released in the Homey App Store, extract the source ZIP on a PC and use the official Homey CLI from that directory:

```powershell
homey login
homey select
homey app validate --level publish
homey app install
```

Do not use `--clean` for updates; it removes existing device data. The ZIP cannot be installed directly from Homey's mobile interface.

Original code is MIT licensed, by [PixelBrouwer](https://github.com/PixelBrouwer). Independent community app. See THIRD_PARTY_NOTICES.md for vendor and protocol notices.
