# Herkomst van de documentatiebeelden

Deze bestanden dienen voor GitHub-documentatie. Het zijn geen extra Store-beelden en geen afbeeldingen met live gebruikersgegevens.

| Bestand | Herkomst |
| --- | --- |
| `banner.svg` | Bewerkbaar bannerontwerp met de originele transparante Voldt-productfoto. Alle lagen zijn begrensd door dezelfde afgeronde bannervorm. |
| `banner-transparent.png` | Gerenderde banner met een echt alfakanaal: de kabel heeft geen wit vlak en de buitenste afgeronde hoeken zijn transparant. Gebruikt in de README en releasetekst. |
| `voldt-product-transparent.png` | De oorspronkelijke, reeds transparante productfoto van Voldt, ongewijzigd hergebruikt. Bron en merkrechten hieronder vermeld. |
| `zo-werkt-het.svg` | Origineel processchema van eenmalige accountkoppeling en dagelijkse lokale bediening. |
| `koppelen.png` | Chromium-opname van het echte formulier uit `drivers/voldt/pair/setup.html`, met Nederlandse appvertalingen en synthetische placeholders. De buitenste omlijsting is een documentatieontwerp. |
| `koppeling-herstellen.png` | Chromium-opname van `settings/index.html`, met een lokale Homey-API-stub die uitsluitend fictieve apparaatgegevens retourneert. De omlijsting is illustratief. |
| `apparaatpaneel-voorbeeld.png` | Expliciet gelabelde HTML-illustratie van de mogelijkheden en sensoren. Geen exacte native Homey-schermafbeelding. Alle meetwaarden zijn fictief. |

Geen echte e-mailadressen, wachtwoorden, apparaat-ID's, lokale sleutels, toegangstokens of netwerkconfiguratie gebruikt. `gebruiker@example.test` is een voorbeeldplaceholder. Het eventuele netwerkadres in de previewstub is fictieve testdata. Er wordt geen verbinding gemaakt met Homey, Voldt of een laadkabel; browsernetwerkverzoeken vanuit de previews zijn geblokkeerd met Content Security Policy.

De afbeeldingen zijn opgebouwd uit SVG en HTML/CSS en gerenderd met de aanwezige headless Chrome-browser. De banner gebruikt de reeds transparante fabrikantfoto, zonder achtergrondverwijdering, nieuwe productgeneratie of witte kaart. De PNG-export gebruikt een transparante pagina-achtergrond; alle bannerlagen zijn afgerond uitgeknipt. De koppel- en instelschermen gebruiken de appcode en het apparaatpaneel is een gelabeld HTML-voorbeeld. Het bestaande Store-beeldmateriaal heeft een eigen herkomstbeschrijving in [ASSETS.md](../../ASSETS.md).

Productfoto: [Voldt-productafbeelding](https://voldt.nl/cdn/shop/files/voldt-portable-charging-cable-schuko-plug-16A-main-image_421ee47c-5093-466b-a4d8-d8a508ca79b7.png?width=1000&format=png). De fabrikantfoto en het merk blijven van hun eigenaar en vallen niet onder de MIT-licentie van de eigen appcode. Het fotobestand is rechtstreeks overgenomen; de bronafbeelding bevat al transparantie.

## Voorbeelden lokaal bekijken

Voer vanuit de repository uit:

```sh
node docs/previews/serve.cjs
```

De server bindt uitsluitend aan `127.0.0.1` en toont zijn lokale adres. Open op dat adres `/pair`, `/settings` of `/device`. Stop met Ctrl+C. De server gebruikt alleen Node.js-standaardbibliotheken; er zijn geen extra pakketten of credentials nodig. Het is een documentatiepreview, geen login- of bedieningsservice.

De schermvoorbeelden zijn 720 × 1120 pixels; de banner is 1280 × 400 pixels. De appformulieren zelf zijn niet opnieuw ontworpen. Bij wijzigingen aan het koppel- of instelformulier kunnen de previews opnieuw worden gerenderd. De drie schermvoorbeelden hebben een zichtbare voorbeeldmarkering; de tekst maakt onderscheid tussen de originele appinterface en het illustratieve apparaatpaneel. Het SVG-bronbestand van de banner verwijst naar de transparante fabrikantfoto; de README gebruikt de zelfstandige PNG-weergave.
