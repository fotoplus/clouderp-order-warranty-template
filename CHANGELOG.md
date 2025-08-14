# Changelog

Minden lényeges változást ebben a fájlban dokumentálunk. A formátum a [Keep a Changelog](https://keepachangelog.com/hu-HU/1.1.0/) ajánlásán alapul, és a verziózás a [Szemantikus Verziózás](https://semver.org/lang/hu/) elveit követi.

## [1.0.0] - 2025-08-14

### Hozzáadva
- Első nyilvános verzió a CloudERP rendeléshez tartozó jótállási dokumentum sablonból (`sablon.html`).
- Termékenkénti oldal(ak) generálása az `items` és `order` JSON-ból (Django `json_script`).
- Jótállási idő számítása, a jogszabály szerinti HUF árkategóriák (2/3 év) figyelembevételével.
- Ezres tagolás szóközzel a pénzösszegeknél (`groupThousandsWithSpace`) és pénznem kiírás (`formatMoney`) HUF esetén a Django `_penz` filterből detektált szimbólummal.
- Csomagkezelés: komponensek effektív jótállása a **csomag teljes ára** alapján.
- Gyáriszám-kezelés: pool/queue logika, példányonkénti kiosztás, duplikáció elkerülés.
- Védett, ES5-kompatibilis megvalósítás; robusztus JSON beolvasás és hibatűrés.
- Részletes, JSDoc stílusú szakmai kommentek és typedef-ek (`SerialMaps`, `MoneyRules`).
- Mintafájlok: `sample_files/order.json`, `sample_files/item.json`.
- Nyomtatható stílusok (tördelés, címkék/sorok, komponens-blokkok).

### Változott
- N/A – első verzió.

### Javítva
- N/A – első verzió.
