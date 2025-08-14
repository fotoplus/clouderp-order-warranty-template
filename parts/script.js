/* =======================================================================
JÓTÁLLÁSI OLDALAK GENERÁLÁSA (ES5)
- Jogszabály szerinti idő figyelembevétele (HUF ár esetén)
- Ezres tagolás szóközzel
- Csomagkezelés és gyáriszám-kiosztás
======================================================================= */



(function () {
	/* -----------------------------
	DOM referenciák és JSON beolvasás
	----------------------------- */

	/** @type {HTMLElement} items JSON <script> tagja */
	var src      = document.getElementById('items-json');
	/** @type {HTMLElement} ide kerülnek a példány-oldalak */
	var listWrap = document.getElementById('products');
	/** @type {HTMLElement} rejtett sablon, ezt klónozzuk */
	var tpl      = document.getElementById('warranty-template');
	if (!src || !listWrap || !tpl) { return; }


	/**
	 * Biztonságosan kinyeri a node szöveges tartalmát.
	 * PDF/HTML környezetben az innerText és textContent eltérhet, ezért fallback-el.
	 *
	 * @param {Node|null} node - Forrás DOM csomópont.
	 * @returns {string} A csomópontból kinyert szöveg, vagy üres string.
	 */
	function getText(node) { return node ? (node.textContent || node.innerText || '') : ''; }

	/** items tömb beolvasása (védett JSON.parse) */
	var raw = getText(src), items = [];
	try { items = raw ? JSON.parse(raw) : []; } catch (e) { items = []; }

	/* -----------------------------
	PÉNZNEMKEZELÉS
	----------------------------- */

	/** @type {string} Pénznem ISO kód (pl. "HUF") – az ORDER-ből */
	var ORDER_CURRENCY = "{{ order.currency|default_if_none:'' }}";
	/** @type {string} Pénznem szimbólum minta a Django _penz filterből (pl. "0 Ft") */
	var CURRENCY_SAMPLE = "{{ 0|_penz:order.currency|escapejs }}";

	/**
	 * Kinyeri a _penz filter által adott mintából a pénznem szimbólumát.
	 * Elvárt forma: "[szám][space][szimbólum]" (pl. "0 Ft", "0 €").
	 * NBSP (U+00A0) → space konverzió után az utolsó token a szimbólum, ha nem szám.
	 *
	 * @param {string} sample - A minta, pl. "0 Ft".
	 * @returns {string} A szimbólum (pl. "Ft"), vagy üres string, ha nem detektálható.
	 */
	function extractCurrencySymbol(sample) {
		if (!sample) return '';
		var s = String(sample).replace(/\u00A0/g, ' ').trim();
		var parts = s.split(' ');
		var last = parts[parts.length - 1] || '';
		if (/^[0-9.,]+$/.test(last)) return '';
		return last;
	}
	/** @type {string} A detektált pénznem szimbólum (pl. "Ft") */
	var CURRENCY_SYMBOL = extractCurrencySymbol(CURRENCY_SAMPLE);

	/**
	 * @typedef {Object} MoneyRules
	 * @property {boolean} convert_all
	 * @property {Object<string, boolean>} convert_only
	 */
	/** @type {MoneyRules} */
	var MONEY_RULES = { convert_all: false, convert_only: { HUF: true } };

	/**
	 * Eldönti, hogy az adott ISO kódhoz szimbólumot (pl. "Ft"), vagy ISO kódot (pl. "EUR") használjunk.
	 *
	 * @param {string} iso - ISO pénznem kód (pl. "HUF").
	 * @returns {boolean} true, ha szimbólumot kell használni; különben false.
	 */
	function shouldUseSymbol(iso) {
		if (!iso) return false;
		if (MONEY_RULES.convert_all) return true;
		return !!(MONEY_RULES.convert_only && MONEY_RULES.convert_only[iso]);
	}

	/**
	 * Ezres tagolást végez szóközzel az egészrészen; megőrzi a tizedesrészt (pont vagy vessző).
	 * Nem lokalizál, csak „szépíti” a megjelenítést.
	 *
	 * @param {string|number} value - Az eredeti érték.
	 * @returns {string} A tagolt érték (pl. "1 234 567,89"), vagy üres string.
	 */
	function groupThousandsWithSpace(value) {
		if (value === null || typeof value === 'undefined') return '';
		var s = String(value).replace(/\u00A0/g, ' ').trim();

		// Az UTOLSÓ pont vagy vessző legyen a tizedes elválasztó:
		var lastDot   = s.lastIndexOf('.');
		var lastComma = s.lastIndexOf(',');
		var decSep = '';
		if (lastDot > -1 || lastComma > -1) {
			decSep = (lastComma > lastDot) ? ',' : (lastDot > lastComma ? '.' : '');
		}

		var intPart = s, fracPart = '';
		if (decSep) {
			var idx = s.lastIndexOf(decSep);
			intPart = s.slice(0, idx);
			fracPart = s.slice(idx + 1);
		}

		var sign = '';
		if (intPart[0] === '-') { sign = '-'; intPart = intPart.slice(1); }

		// Csak számjegyek maradjanak az egészrészben:
		intPart = intPart.replace(/[^0-9]/g, '');

		// Ezres tagolás:
		var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

		return sign + grouped + (decSep ? (decSep + fracPart) : '');
	}

	/**
	 * Összeg + pénznem formázása.
	 * - HUF esetén a _penz mintából nyert szimbólumot (pl. "Ft") használjuk,
	 *   egyébként az ISO kódot (pl. "EUR").
	 * - Az összeg ezres tagolása a groupThousandsWithSpace függvénnyel történik.
	 *
	 * @param {string|number} value - Az összeg (sztringként is érkezhet).
	 * @param {string} [iso] - ISO kód; ha nincs megadva, az ORDER_CURRENCY-t használjuk.
	 * @returns {string} Pl. "12 345 Ft" vagy "12 345 EUR"; üres, ha nincs érték.
	 */
	function formatMoney(value, iso) {
		var code = iso || ORDER_CURRENCY || '';
		if (value === null || typeof value === 'undefined' || value === '') return '';
		var amountStr = groupThousandsWithSpace(value);
		if (!amountStr) return '';
		var label = (shouldUseSymbol(code) && CURRENCY_SYMBOL) ? CURRENCY_SYMBOL : code;
		return amountStr + ' ' + label;
	}

	/* -----------------------------
	ORDER beolvasása + gyáriszám mapek
	----------------------------- */

	/** @type {HTMLElement} ORDER JSON <script> tagja */
	var srcOrder = document.getElementById('order-json');
	/** @type {Object} ORDER objektum */
	var rawOrder = getText(srcOrder), order = {};
	try { order = rawOrder ? JSON.parse(rawOrder) : {}; } catch (e) { order = {}; }

	/**
	 * @typedef {Object} SerialMaps
	 * @property {Object<string, string[]>} pool
	 * @property {Object<string, string>}  byNumber
	 */
	/**
	 * ORDER alapján két gyors-keresésű struktúrát épít:
	 * - pool: SKU → [gyáriszám, ...] FIFO jellegű (queue)
	 * - byNumber: gyáriszám → SKU visszakereséshez
	 *
	 * @param {Object} ord - ORDER objektum (benne: product_number_relationship_list).
	 * @returns {SerialMaps}
	 */
	function buildSerialMapsFromOrder(ord) {
		var pool = {}, byNumber = {};
		var arr = (ord && ord.product_number_relationship_list) || [];
		for (var i = 0; i < arr.length; i++) {
			var r = arr[i] || {};
			var sku = r.product_sku, num = r.number;
			if (!sku || !num) continue;
			var q = Number(r.quantity); if (!isFinite(q) || q <= 0) q = 1;
			if (!pool[sku]) pool[sku] = [];
			for (var j = 0; j < q; j++) pool[sku].push(String(num));
			byNumber[String(num)] = sku;
		}
		return { pool: pool, byNumber: byNumber };
	}
	/** @type {SerialMaps} */
	var maps = buildSerialMapsFromOrder(order);
	/** @type {Object<string,string[]>} SKU -> elérhető gyáriszámok */
	var orderSerialPool   = maps.pool;
	/** @type {Object<string,string>} gyáriszám -> SKU */
	var serialSkuByNumber = maps.byNumber;

	/* -----------------------------
	Általános segédek
	----------------------------- */

	/**
	 * Ürességvizsgálat általános típusokra.
	 *
	 * @param {*} v - Vizsgálandó érték.
	 * @returns {boolean} true, ha üres/hiányzó; különben false.
	 */
	function isEmpty(v) {
		if (v === null || v === undefined) return true;
		if (typeof v === 'string') return v.trim() === '';
		if (Object.prototype.toString.call(v) === '[object Array]') return v.length === 0;
		return false;
	}

	/**
	 * Hozzáad egy (címke, érték) sort a megadott szülő elemhez:
	 * <div class="row"><span class="label">Címke: </span><span class="value">Érték</span></div>
	 *
	 * @param {HTMLElement} parent - Szülő elem, ahová a sort illesztjük.
	 * @param {string} label - Címke (bal oldal).
	 * @param {string|number} value - Megjelenítendő érték (jobb oldal).
	 */
	function addRow(parent, label, value) {
		var row = document.createElement('div'); row.className = 'row';
		var lab = document.createElement('span'); lab.className = 'label';
		lab.appendChild(document.createTextNode(label + ': '));
		var val = document.createElement('span'); val.className = 'value';
		val.appendChild(document.createTextNode(String(value)));
		row.appendChild(lab); row.appendChild(val); parent.appendChild(row);
	}

	/**
	 * Feltételes sor-hozzáadás: csak akkor ír, ha a value nem üres.
	 *
	 * @param {HTMLElement} parent - Szülő elem.
	 * @param {string} label - Címke.
	 * @param {*} value - Érték; ha "üres", nem írunk sort.
	 */
	function addRowIf(parent, label, value) { if (!isEmpty(value)) addRow(parent, label, value); }

	/**
	 * Mennyiség normalizálása:
	 * - NaN, ≤0 → 1
	 * - tört érték → 1
	 * - egyébként az egész érték.
	 *
	 * @param {number|string} q - Bemeneti mennyiség.
	 * @returns {number} Egész, legalább 1.
	 */
	function intQty(q) {
		var n = Number(q);
		if (!isFinite(n) || n <= 0) return 1;
		return Math.floor(n) === n ? n : 1;
	}

	/* -----------------------------
	Jótállás (label + számítás)
	----------------------------- */

	/**
	 * Emberbarát jótállási címkét készít az adott periódus és egység alapján.
	 * Felismeri: nap(1), hét(7), hónap(30), év(365); ismeretlen egységnél a*b nap.
	 *
	 * @param {number|string} period - Periódus (darabszám).
	 * @param {number|string} unit - Egység (nap=1, hét=7, hónap=30, év=365).
	 * @returns {string} Pl. "2 év", "6 hónap", "30 nap", vagy üres, ha nem értelmezhető.
	 */
	function warrantyLabel(period, unit) {
		var a = Number(period), b = Number(unit);
		if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return '';
		var unitName = (b === 1 ? 'nap' : (b === 7 ? 'hét' : (b === 30 ? 'hónap' : (b === 365 ? 'év' : ''))));
		return unitName ? (a + ' ' + unitName) : ((a * b) + ' nap');
	}

	/**
	 * Visszaadja a termékre beállított jótállási időt napokban.
	 * Ha nincs érvényes adat, 0-t ad vissza.
	 *
	 * @param {Object} prod - A termék objektum, jótállási mezőkkel.
	 * @returns {number} A jótállási idő napokban, vagy 0 ha nincs megadva.
	 */
	function warrantyDaysFromProd(prod) {
		var a = Number(prod && prod.warranty_period);
		var b = Number(prod && prod.warranty_period_unit);
		if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return 0;
		return a * b;
	}

	/**
	 * Napokból emberbarát címkét készít (év/hónap/nap preferencia sorrendben).
	 *
	 * @param {number} days - Napok száma.
	 * @returns {string} Pl. "3 év", "2 hónap", "45 nap" vagy üres, ha 0/érvénytelen.
	 */
	function daysToDisplayLabel(days) {
		var d = Number(days);
		if (!isFinite(d) || d <= 0) return '';
		if (d % 365 === 0) return (d / 365) + ' év';
		if (d % 30  === 0) return (d / 30)  + ' hónap';
		return d + ' nap';
	}

	/**
	 * Jogszabály szerinti jótállás napokban a vételár alapján (csak HUF esetén).
	 * - 10 000 Ft ≤ ár < 250 000 Ft  → 2 év
	 * - 250 000 Ft ≤ ár              → 3 év
	 * - egyéb (vagy nem HUF)         → 0
	 *
	 * @param {number|string} price - Bruttó ár.
	 * @param {string} iso - ISO pénznem kód (csak "HUF" esetén érvényes).
	 * @returns {number} Napok száma (0, ha nem alkalmazható).
	 */
	function statutoryDaysForPrice(price, iso) {
		if (String(iso || '').toUpperCase() !== 'HUF') return 0;
		var p = Number(price);
		if (!isFinite(p) || p <= 0) return 0;
		if (p >= 250000) return 3 * 365;
		if (p >= 10000)  return 2 * 365;
		return 0;
	}

	/**
	 * Fő tétel effektív jótállási címkéje:
	 * max( beállított napok, jogszabály szerinti napok az ITEM ár alapján ).
	 *
	 * @param {Object} prod - Termék objektum (beállított jótállás).
	 * @param {number|string} grossPrice - Tétel bruttó ára.
	 * @param {string} iso - ISO pénznem kód.
	 * @returns {string} Emberbarát címke (pl. "3 év") vagy üres.
	 */
	function effectiveWarrantyLabelForItem(prod, grossPrice, iso) {
		var conf = warrantyDaysFromProd(prod);
		var stat = statutoryDaysForPrice(grossPrice, iso);
		return daysToDisplayLabel(Math.max(conf, stat));
	}

	/**
	 * Csomag-összetevő effektív jótállási címkéje:
	 * max( beállított napok, jogszabály szerinti napok a CSOMAG ÁRA alapján ).
	 *
	 * @param {Object} compProd - Összetevő termék objektum.
	 * @param {number|string} bundleGrossPrice - A csomag teljes bruttó ára.
	 * @param {string} iso - ISO pénznem kód.
	 * @returns {string} Emberbarát címke (pl. "2 év") vagy üres.
	 */
	function effectiveWarrantyLabelForComponent(compProd, bundleGrossPrice, iso) {
		var conf = warrantyDaysFromProd(compProd);
		var stat = statutoryDaysForPrice(bundleGrossPrice, iso);
		return daysToDisplayLabel(Math.max(conf, stat));
	}

	/* -----------------------------
	Renderelési feltételek
	----------------------------- */

	/**
	 * Van-e a terméken érvényes (beállított) jótállási adat?
	 *
	 * @param {Object} prod - Termék objektum.
	 * @returns {boolean} true, ha >0 nap; különben false.
	 */
	function hasWarrantyData(prod) { return warrantyDaysFromProd(prod) > 0; }

	/**
	 * Bármely csomagkomponens rendelkezik-e érvényes jótállással?
	 *
	 * @param {Array<Object>} bundleElements - Csomag-elemek listája.
	 * @returns {boolean} true, ha bármelynek >0 nap; különben false.
	 */
	function anyComponentHasWarranty(bundleElements) {
		if (!bundleElements || !bundleElements.length) return false;
		for (var i = 0; i < bundleElements.length; i++) {
			var p = (bundleElements[i] && bundleElements[i].product) || {};
			if (hasWarrantyData(p)) return true;
		}
		return false;
	}

	/**
	 * Van-e a tételen bármilyen gyáriszám?
	 *
	 * @param {Object} item - Tétel objektum (product_number_relationship_list mezővel).
	 * @returns {boolean} true, ha legalább egy serial van; különben false.
	 */
	function itemHasAnySerial(item) {
		var arr = expandSerials(item && item.product_number_relationship_list);
		return arr.length > 0;
	}

	/* -----------------------------
	Gyáriszám lista segédek
	----------------------------- */

	/**
	 * Gyáriszám-lista kibontása (quantity szerint): {number:'A', quantity:2} → ['A','A'].
	 *
	 * @param {Array<{number:string, quantity:number}>} list - Serial elemek listája.
	 * @returns {string[]} Kinyert gyáriszámok.
	 */
	function expandSerials(list) {
		var out = [];
		if (!list || !list.length) return out;
		for (var i = 0; i < list.length; i++) {
			var e = list[i] || {};
			var num = e.number;
			if (!num) continue;
			var q = Number(e.quantity); if (!isFinite(q) || q <= 0) q = 1;
			for (var j = 0; j < q; j++) out.push(String(num));
		}
		return out;
	}

	/**
	 * Gyáriszámok példányokra osztása.
	 * - qty=1: az összes serial egy sorban
	 * - s.length==qty: egy-egy
	 * - s.length<qty: ami jut, a többi üres
	 * - s.length>qty és qty>1: az utolsó kapja a maradékot
	 *
	 * @param {number} qty - Példányszám.
	 * @param {string[]} serials - Elérhető gyáriszámok.
	 * @returns {string[]} Példányonkénti sorok.
	 */
	function assignSerials(qty, serials) {
		var n = qty > 0 ? qty : 1;
		var result = []; for (var i = 0; i < n; i++) result.push('');
		var s = serials || [];
		if (n === 1) { result[0] = s.length ? s.join(', ') : ''; return result; }
		if (s.length === n) { for (i = 0; i < n; i++) result[i] = s[i]; return result; }
		if (s.length < n) { for (i = 0; i < s.length; i++) result[i] = s[i]; return result; }
		for (i = 0; i < n - 1; i++) result[i] = s[i];
		result[n - 1] = [s[n - 1]].concat(s.slice(n)).join(', ');
		return result;
	}

	/* -----------------------------
	Termék mezők kirajzolása
	----------------------------- */

	/**
	 * A termék fő mezőit írja ki; a jótállást opcionálisan felül lehet írni
	 * egy előre kiszámolt címkével (effektív jótállás).
	 *
	 * @param {HTMLElement} parent - A cél DOM elem.
	 * @param {Object} prod - Termék objektum.
	 * @param {string} [warrantyOverrideLabel] - Felülíró jótállási címke (ha megadott).
	 */
	function renderProductCore(parent, prod, warrantyOverrideLabel) {
		addRowIf(parent, 'Termék megnevezése', prod.primary_category_name);
		addRowIf(parent, 'Termék típusa',      prod.display_name);
		addRowIf(parent, 'SKU',                prod.sku);

		var wl = warrantyOverrideLabel || warrantyLabel(prod.warranty_period, prod.warranty_period_unit);
		if (wl) addRow(parent, 'Jótállási idő', wl);

		addRowIf(parent, 'Gyártó',             prod['manufacturer__name']);
		addRowIf(parent, 'Származási ország',  prod.country_of_origin);
	}

	/* -----------------------------
	Gyáriszám pool/queue kezelés
	----------------------------- */

	/**
	 * Egy megadott érték ELSŐ előfordulását eltávolítja a tömbből (in-place).
	 *
	 * @param {Array} arr - Forrás tömb.
	 * @param {*} value - Eltávolítandó érték.
	 */
	function removeOne(arr, value) {
		if (!arr || !arr.length) return;
		for (var i = 0; i < arr.length; i++) { if (arr[i] === value) { arr.splice(i, 1); return; } }
	}

	/**
	 * Nem csomag tételek gyáriszámait levonja az ORDER poolból,
	 * hogy a csomag komponensek kiosztásánál már csak a maradék maradjon.
	 *
	 * @param {Array<Object>} items - Rendelés tételei.
	 * @param {Object<string,string[]>} pool - SKU → gyáriszámok (globális készlet).
	 */
	function consumeStandaloneSerials(items, pool) {
		for (var i = 0; i < items.length; i++) {
			var it = items[i] || {};
			var isBundle = it.bundle_elements && it.bundle_elements.length;
			if (isBundle) continue;
			var prod = it.product || {};
			var sku  = prod && prod.sku;
			if (!sku) continue;
			var serials = expandSerials(it.product_number_relationship_list || []);
			for (var j = 0; j < serials.length; j++) {
				removeOne(pool[sku] || [], serials[j]);
			}
		}
	}

	/**
	 * Egy tétel saját gyáriszám- listájából per-SKU lokális sorokat (queue-kat) képez.
	 * A serial→SKU megfeleltetéshez az ORDER byNumber mapet használja.
	 *
	 * @param {string[]} serials - A tételhez tartozó gyáriszámok.
	 * @param {Object<string,string>} serialByNumber - Gyáriszám→SKU map.
	 * @param {string} [fallbackSku] - Használandó SKU, ha nincs találat az ORDER-ben.
	 * @returns {Object<string,string[]>} SKU → lokális serial-queue.
	 */
	function buildQueuesFromItemSerials(serials, serialByNumber, fallbackSku) {
		var m = {};
		for (var i = 0; i < serials.length; i++) {
			var num = serials[i];
			var sku = serialByNumber[num] || fallbackSku || '';
			if (!sku) continue;
			if (!m[sku]) m[sku] = [];
			m[sku].push(num);
		}
		return m;
	}

	/**
	 * Kioszt EGY gyáriszámot egy SKU-hoz: először a lokális queue-ból, ha nincs, az ORDER poolból.
	 * A kiválasztott értéket a poolból is eltávolítja a duplikáció elkerülésére.
	 *
	 * @param {string} sku - Cél SKU.
	 * @param {Object<string,string[]>} localQueues - Lokális queue-k (tétel-szint).
	 * @param {Object<string,string[]>} pool - Globális pool (ORDER).
	 * @returns {string} A kiosztott gyáriszám, vagy üres string.
	 */
	function allocOneForSku(sku, localQueues, pool) {
		if (sku && localQueues && localQueues[sku] && localQueues[sku].length) {
			var v = localQueues[sku].shift();
			removeOne(pool[sku] || [], v);
			return v;
		}
		if (sku && pool[sku] && pool[sku].length) {
			return pool[sku].shift();
		}
		return '';
	}

	/**
	 * Ellenőrzi, hogy elérhető-e legalább egy gyáriszám az adott SKU-hoz
	 * (vagy a lokális queue-ban, vagy a globális poolban).
	 *
	 * @param {string} sku - Vizsgált SKU.
	 * @param {Object<string,string[]>} localQueues - Lokális queue-k.
	 * @param {Object<string,string[]>} pool - Globális pool.
	 * @returns {boolean} true, ha van serial; különben false.
	 */
	function hasAvailableSerialForSku(sku, localQueues, pool) {
		if (!sku) return false;
		if (localQueues && localQueues[sku] && localQueues[sku].length) return true;
		if (pool && pool[sku] && pool[sku].length) return true;
		return false;
	}

	/* -----------------------------
	Csomag komponensek renderelése
	----------------------------- */

	/**
	 * Csomag összetevők kirajzolása.
	 * - Csak azok az összetevők kerülnek ki, amelyeknek van beállított jótállása VAGY
	 *   elérhető hozzájuk legalább egy gyáriszám.
	 * - Összetevőnként/példányonként kioszt egy gyáriszámot (ha van).
	 * - Az összetevő effektív jótállását a CSOMAG ÁRA alapján is értékeli.
	 *
	 * @param {HTMLElement} parent - A szülő elem (fő tétel blokkja).
	 * @param {Array<Object>} bundleElements - Csomag-összetevők.
	 * @param {Object<string,string[]>} localQueues - Lokális serial-queue-k (tétel).
	 * @param {Object<string,string[]>} pool - ORDER pool (globális).
	 * @param {number|string} bundleGrossPrice - A csomag bruttó ára (jogszabályi vizsgálathoz).
	 */
	function renderComponents(parent, bundleElements, localQueues, pool, bundleGrossPrice) {
		if (!bundleElements || !bundleElements.length) return;

		var wrap  = document.createElement('div'); wrap.className = 'components';
		var title = document.createElement('div'); title.className = 'row';
		title.innerHTML = '<strong>Csomag összetevők</strong>';
		wrap.appendChild(title);

		for (var i = 0; i < bundleElements.length; i++) {
			var be = bundleElements[i] || {};
			var p  = be.product || {};
			var count = intQty(be.quantity);
			var sku   = p && p.sku;

			// Csak akkor, ha van jótállás VAGY van legalább egy serial
			if (!hasWarrantyData(p) && !hasAvailableSerialForSku(sku, localQueues, pool)) {
				continue;
			}

			// Effektív jótállás (összetevő): max(beállított, jogszabály a CSOMAG ÁRA alapján)
			var effLabel = effectiveWarrantyLabelForComponent(p, bundleGrossPrice, ORDER_CURRENCY);

			for (var r = 0; r < count; r++) {
				var comp = document.createElement('div'); comp.className = 'component';
				addRow(comp, 'Összetevő példány', (r + 1) + ' / ' + count);
				renderProductCore(comp, p, effLabel);

				// Serial kiosztás (ha van)
				if (sku) {
					var s = allocOneForSku(sku, localQueues, pool);
					addRowIf(comp, 'Gyáriszám(ok)', s);
				}
				wrap.appendChild(comp);
			}
		}

		// Ha csak a cím maradt (nincs tényleges komponens), ne tegyük ki
		if (wrap.children.length > 1) parent.appendChild(wrap);
	}

	/* -----------------------------
	Előkészítés
	----------------------------- */

	// Nem csomag tételek gyáriszámait levonjuk a globális poolból
	consumeStandaloneSerials(items, orderSerialPool);

	/* -----------------------------
	Oldalak generálása
	----------------------------- */
	for (var i = 0; i < items.length; i++) {
		var item     = items[i] || {};
		var prod     = item.product || {};
		var qty      = intQty(item.quantity);
		var isBundle = item.bundle_elements && item.bundle_elements.length;

		// Döntés: legyen-e oldal?
		// 1) van beállított jótállás VAGY
		// 2) bármely komponensnek van jótállása VAGY
		// 3) van bármilyen gyáriszám a tételen
		var renderMainHasWarranty    = hasWarrantyData(prod);
		var renderHasAnyCompWarranty = anyComponentHasWarranty(item.bundle_elements);
		var renderHasSerials         = itemHasAnySerial(item);
		if (!renderMainHasWarranty && !renderHasAnyCompWarranty && !renderHasSerials) {
			continue;
		}

		// item saját serialok
		var serialList     = expandSerials(item.product_number_relationship_list || []);
		var perPageSerials = isBundle ? [] : assignSerials(qty, serialList);

		// bundle lokális queue-k (ha kell)
		var bundleSkuQueues = null;
		if (isBundle) {
			var fallback = (prod && prod.sku) || '';
			bundleSkuQueues = buildQueuesFromItemSerials(serialList, serialSkuByNumber, fallback);
		}

		// Fő tétel effektív jótállása: max(beállított, jogszabály az ITEM ár alapján)
		var mainEffLabel = effectiveWarrantyLabelForItem(prod, item.gross_price, ORDER_CURRENCY);

		// Példányonként 1 oldal
		for (var k = 0; k < qty; k++) {
			var page = tpl.cloneNode(true);
			page.removeAttribute('id');
			page.style.display = '';

			var slot = page.getElementsByClassName('product-slot')[0];
			if (slot) {
				addRow(slot, 'Példány', (k + 1) + ' / ' + qty);

				// Fő termék adatai + effektív jótállás
				renderProductCore(slot, prod, mainEffLabel);

				// Gyáriszám(ok) – csak nem csomagnál
				if (!isBundle) {
					var serialText = perPageSerials[k] || '';
					addRowIf(slot, 'Gyáriszám(ok)', serialText);
				}

				// Megjegyzés + Vételár (összeg ezres tagolással, pénznem szabály szerint)
				addRowIf(slot, 'További (azonosító) adat(ok)', item.comment);
				addRowIf(slot, 'Vételár', formatMoney(item.gross_price, ORDER_CURRENCY));

				// Csomag komponensek (effektív jótállás a CSOMAG ÁRA szerint)
				if (isBundle) {
					renderComponents(slot, item.bundle_elements, bundleSkuQueues, orderSerialPool, item.gross_price);
				}
			}
			listWrap.appendChild(page);
		}
	}
})(); // IIFE vége