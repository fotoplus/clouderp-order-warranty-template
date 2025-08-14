# CloudERP – Rendeléshez tartozó jótállási sablon

Ez a sablon a CloudERP rendelésdokumentum-generálásához készült. A `sablon.html` egy önálló (ES5) kliensoldali scriptet tartalmaz, amely a Django által a HTML-be beágyazott rendelési és tételadatokból többoldalas **jótállási jegyet** állít elő.

## Mit old meg?

- **Jótállási idő**: kiírja a terméken beállított jótállást, és HUF ár esetén figyelembe veszi a **jogszabály szerinti minimumot** (≥10 000 Ft → 2 év, ≥250 000 Ft → 3 év).
- **Csomagok és komponensek**: csomag tételeknél külön blokkokban jeleníti meg az al-termékeket és azok effektív jótállását (a **csomag ára** alapján).
- **Gyáriszámok**: kezeli a gyáriszám-listákat, példányszámhoz osztja, és csomagoknál sorból/poolból kiosztja.
- **Pénzmegjelenítés**: ezres tagolás **szóközzel**; HUF esetén szimbólum (pl. „Ft”), máskor ISO kód.
- **Nyomtatás/PDF**: oldalankénti blokkok, töréspont-védett szakaszok a szebb PDF-hez.

## Hogyan működik?

1. A Django két JSON-t ágyaz be a dokumentumba:
   ```django
   {{ items|json_script:"items-json" }}
   {{ order|json_script:"order-json" }}
   ```
2. A script ezeket beolvassa, majd:
   - csak akkor generál oldalt, ha **van jótállás** (fő termék vagy bármely komponens) **vagy** **van gyáriszám**;
   - példányszámonként külön oldalt hoz létre a rejtett `#warranty-template` klónozásával;
   - csomagoknál a komponenseket és (ha elérhető) a kiosztott gyáriszámot is kiírja.

## Bemenet (minták)

A repó tartalmaz két minta inputot, amelyek a Django által átadott struktúrát szemléltetik:  
`sample_files/item.json` – tétellista (pl. csomag, gyáriszámok, árak)  
`sample_files/order.json` – rendelés metaadatok (pl. pénznem, számlaszám, átadás ideje, gyáriszám→SKU megfeleltetés)

## Gyors indítás

1. Hozz létre CloudERP-ben egy új HTML sablont és illeszd be a `sablon.html` tartalmát.
2. Gondoskodj róla, hogy a sablon kontextusában legyen `items` és `order`, valamint a használt Django filterek (pl. `_penz`, `_datum`).
3. Generálj PDF-et: a sablon az adatok alapján automatikusan felépíti az oldalakat.

## Testreszabás

- **Jogszabályi küszöbök** és a HUF-hoz kötött logika a scriptben paraméterezhető.
- **Pénznemlogika** (`MONEY_RULES`) módosításával állítható, mikor használjon szimbólumot vs. ISO kódot.
- **Megjelenés**: a beépített CSS print-barát; tipográfia, töréspontok, címkék ízlés szerint szerkeszthetők.

## Megjegyzések

- A jogszabály szerinti jótállás jelen sablonban **csak HUF** esetén érvényesül (külföldi pénznemeknél nem kerül alkalmazásra).
- PDF generátorok közt eltérés lehet az `innerText`/`textContent` kezelésében; a script erre védetten olvas.
