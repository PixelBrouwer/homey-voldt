# Voldt met Homey

[Hoofdpagina](README.md) · [Visuele rondleiding met schermvoorbeelden](docs/ZO-WERKT-HET.nl.md) · [English](GUIDE.en.md)

> [!WARNING]
> Deze app is nog niet officieel gecertificeerd door Athom/Homey. Installatie en gebruik zijn volledig op eigen risico. PixelBrouwer werkt deze repository bij zodra de certificering is verleend.

**Openbare broncode:** deze versie 1.0.0 is gesanitiseerd. De private OEM-configuratie ontbreekt; zelfgebouwde versies kunnen pas met een Voldt-account aanmelden nadat die configuratie afzonderlijk is geleverd. Zie README.md en SECURITY.md. Onderstaande stappen beschrijven een geconfigureerde build; de werkende productie-installatie is niet gewijzigd.

Voor Homey Pro met Homey 12.9 of nieuwer. Getest met Homey Pro (2026) en een Voldt Schuko 230 V / 3,7 kW wifi-laadkabel. Homey Pro (2023) gebruikt dezelfde lokale apparchitectuur; dit model is niet afzonderlijk getest. Homey Cloud/Bridge, Bluetooth-only kabels en OCPP-bediening worden niet ondersteund.

## Eerste koppeling

1. Verbind de kabel eerst met wifi in de officiële Voldt-app. Controleer dat je hem met je Voldt-account kunt bedienen.
2. Zorg dat Homey en kabel elkaar op het lokale netwerk kunnen bereiken. Gebruik geen geïsoleerd gastnetwerk. Een DHCP-reservering voor de kabel voorkomt problemen na een IP-wijziging.
3. Open **Homey → Apparaten → + → Nieuw apparaat → Voldt → Voldt-kabel (lokaal wifi)**.
4. Vul je Voldt-e-mailadres en wachtwoord in. Bij **Account- en netwerkopties** staan landcode en regio. Voor een Nederlands account: **31 / Europa**. Vul daar eventueel het lokale IP-adres van de kabel in.
5. Kies **Aanmelden en kabels zoeken**. Homey controleert het account, de laadfuncties, de sleutel en de lokale verbinding.
6. Selecteer je kabel in de Homey-apparatenlijst, kies een naam en de gewenste zone, bijvoorbeeld **Buiten**.

Koppelen leest de huidige laadinstelling en start of stopt het laden niet. Je hoeft geen sleutel, device-ID of DP-nummer over te typen. Wachtwoord wordt niet opgeslagen. De tijdelijke accountsessie verloopt na tien minuten; de lokale apparaatsleutel blijft in de apparaatopslag van Homey.

## Bestaande kabel opnieuw koppelen

Open **Meer → Apps → Voldt → App configureren**. Kies het bestaande apparaat, meld aan, selecteer de gevonden kabel en kies **Lokale koppeling herstellen**. Deze route werkt ook als Homey geen knop Onderhoud of Repareren toont. Apparaat, zone en bestaande Flows blijven behouden. Je kunt uitsluitend dezelfde fysieke kabel opnieuw aan dat apparaat koppelen.

Gebruik dit na een wifi-reset, gewijzigde lokale sleutel of gewijzigd IP-adres. Je kunt de bestaande tegel gewoon behouden; voeg geen tweede tegel voor dezelfde kabel toe.

## Bedienen en meten

Open je kabel onder **Apparaten**. **Laadschakelaar** geeft toestemming voor laden; de auto en de beveiligingen van de kabel bepalen of er werkelijk stroom loopt. Controleer **Laadstatus** en **Actueel laadvermogen** voor de werkelijke activiteit. Laden kan pas beginnen als de auto is aangesloten en laden accepteert.

| Veld | Betekenis |
| --- | --- |
| Actueel laadvermogen | Door de kabel gemeten vermogen in W; 2.800 W is 2,8 kW. |
| Totaal geladen energie | Door de kabel gerapporteerde totaalteller in kWh. |
| Energie laadbeurt | Door de kabel gerapporteerde energie van de laadbeurt in kWh, indien beschikbaar. |
| Kabeltemperatuur | Temperatuur van de kabel/controller in °C. |
| Ingestelde stroom | Stroomlimiet in A, geen gemeten laadstroom. Alleen uitlezen. |
| Laadstatus | Onder meer aangesloten, wachten, laden, pauze, gereed of storing. |

Standaard leest Homey elke 15 seconden. Het interval is aanpasbaar bij de geavanceerde apparaatinstellingen, minimaal 10 seconden. De sensoren ondersteunen Homey Insights; vermogen en totaalteller zijn gekoppeld aan Homey Energy. Firmware bepaalt welke waarden beschikbaar zijn. Een niet gerapporteerde waarde blijft onbekend. Een door de kabel gerapporteerde nul blijft nul; de app berekent geen vervangende kWh uit vermogen.

## Flows

Gebruik de standaard Homey-kaarten bij deze kabel: **Begin met opladen**, **Stop met opladen**, de laadvoorwaarde en de triggers voor wijzigingen. De laadvoorwaarde volgt de laadschakelaar; voor werkelijk energiegebruik kun je een voorwaarde op **Actueel laadvermogen** toevoegen. Voorbeeld: een tijdstip als trigger, kabel als actie **Begin met opladen**. Maak een tweede Flow voor **Stop met opladen**.

## Problemen oplossen

- **Geen kabel gevonden:** controleer account, landcode en regio; sluit de officiële app tijdelijk; controleer netwerkisolatie en vul het kabel-IP in bij de netwerkopties.
- **Koppeling verlopen:** meld opnieuw aan. Bij een onvolledige tegel kan dat via App configureren.
- **Lokaal onbereikbaar:** controleer wifi, IP-adres en of een andere lokale app de kabel bezet houdt. Koppel zo nodig opnieuw via App configureren.
- **Opdracht niet bevestigd:** controleer de actuele toestand op de kabel. De app herhaalt een mogelijk al verstuurde laadopdracht niet automatisch.
- **Extra accountverificatie/captcha:** deze app kan die niet tonen. Rond verificatie af in de officiële app en probeer opnieuw; blijft die vereist, dan werkt deze inlogroute voorlopig niet voor dat account.
- **Geen e-mail/wachtwoordlogin:** Apple/Google-login en accountregistratie zijn niet ingebouwd.

Alleen de eerste koppeling en het opnieuw ophalen van een sleutel vereisen internet en de Voldt-accountdienst. Daarna lopen bediening en metingen rechtstreeks tussen Homey en kabel. Er is geen pc, Tuya-ontwikkelaarsproject of Smart Life-migratie nodig.

## Communityversie installeren

Zolang deze app niet in de Homey App Store staat, is installatie een ontwikkelaarsstap vanaf een pc. Pak de broncode-ZIP uit, installeer de officiële Homey CLI, meld aan en selecteer je Homey. Voer vanuit de uitgepakte appmap uit:

```powershell
homey login
homey select
homey app validate --level publish
homey app install
```

Gebruik bij een update geen `--clean`; daarmee zouden bestaande apparaatgegevens worden gewist. De ZIP is geen bestand dat je rechtstreeks in de mobiele Homey-app kunt openen om te installeren.

Broncode: MIT, auteur [PixelBrouwer](https://github.com/PixelBrouwer). Onafhankelijke community-integratie. Zie THIRD_PARTY_NOTICES.md voor merk- en bronvermelding.
