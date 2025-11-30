const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const DIGITRAFFIC_BASE = "https://rata.digitraffic.fi/api/v1";
const DEFAULT_ORIGIN_STATION = "HKI"; // jos station-parametria ei anneta

// Apufunktio: tämän päivän päivämäärä muodossa "YYYY-MM-DD"
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Hakee kaikki Z-junat kyseiseltä päivältä
async function fetchZTrainsToday() {
  const today = getTodayDateString();
  const url = `${DIGITRAFFIC_BASE}/trains/${today}`;

  console.log("Haetaan junat osoitteesta:", url);

  const res = await fetch(url, {
    headers: {
      "Digitraffic-User": "Sauli-Zjuna-demo"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Digitraffic virhe:", res.status, text);
    throw new Error("Digitraffic API palautti virheen: " + res.status);
  }

  const trains = await res.json();
  const zTrains = trains.filter((t) => t.commuterLineID === "Z");

  console.log("Z-junien määrä tänään:", zTrains.length);

  return zTrains;
}

// Laskee viiveen yhdelle aikatauluriville (minuutteina)
function delayMinutesForRow(row) {
  const scheduled = row.scheduledTime ? new Date(row.scheduledTime) : null;
  const actual = row.actualTime
    ? new Date(row.actualTime)
    : row.liveEstimateTime
    ? new Date(row.liveEstimateTime)
    : null;

  if (!scheduled || !actual) return 0;
  return Math.round((actual - scheduled) / 60000);
}

// Hakee useamman seuraavan Z-junan tietylle asemalle,
// ja haluttaessa vain sellaiset, jotka jatkavat target-asemalle myöhemmin.
async function getNextZTrainsFromStation(stationCode, targetCode, limit) {
  const zTrains = await fetchZTrainsToday();
  const now = new Date();
  const departures = [];

  zTrains.forEach((train) => {
    const rows = train.timeTableRows || [];

    // Etsi lähtörivi tältä asemalta (DEPARTURE)
    const departIndex = rows.findIndex(
      (r) => r.stationShortCode === stationCode && r.type === "DEPARTURE"
    );
    if (departIndex === -1) {
      return; // tämä juna ei lähde tältä asemalta
    }

    // Jos targetCode annettu (esim. Mäntsälä -> HKI), varmista että kohdeasema on myöhemmin reitillä
    if (targetCode) {
      const targetIndex = rows.findIndex(
        (r) => r.stationShortCode === targetCode
      );
      if (targetIndex === -1 || targetIndex <= departIndex) {
        return; // väärä suunta (ei jatka halutulle asemalle)
      }
    }

    const row = rows[departIndex];
    const scheduledTime = new Date(row.scheduledTime);

    // Vain tulevat lähdöt
    if (scheduledTime > now) {
      const delay = delayMinutesForRow(row);
      departures.push({
        stationShortCode: stationCode,
        trainNumber: train.trainNumber,
        departureDate: train.departureDate,
        scheduledTime: row.scheduledTime,
        actualTime: row.actualTime || row.liveEstimateTime || null,
        delayMinutes: delay,
        cancelled: train.cancelled || row.cancelled
      });
    }
  });

  if (departures.length === 0) {
    return [];
  }

  departures.sort(
    (a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)
  );

  return departures.slice(0, limit);
}

// API: seuraavat Z-junat asemalta (JSON-lista)
app.get("/api/next-z-train", async (req, res) => {
  try {
    const station = req.query.station || DEFAULT_ORIGIN_STATION;
    const target = req.query.target || null;
    const count = parseInt(req.query.count || "1", 10);

    const list = await getNextZTrainsFromStation(station, target, count);

    if (!list || list.length === 0) {
      return res.status(404).json({
        error: "Ei tulevia Z-junia tälle asemalle tänään.",
        stationShortCode: station
      });
    }

    if (count === 1) {
      return res.json(list[0]);
    }

    res.json(list);
  } catch (err) {
    console.error("Virhe junatiedoissa:", err);
    res.status(500).json({ error: "Virhe junatiedoissa" });
  }
});

// Etusivu: VR-tyylinen kortti-ulkoasu
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fi">
  <head>
    <meta charset="UTF-8" />
    <title>Z-junaseuranta</title>
    <style>
      :root {
        --vr-green: #007b3d;
        --vr-green-dark: #00552a;
        --bg-dark: #0b1a12;
        --card-bg: #111f16;
        --text-main: #f7f7f7;
        --text-muted: #a0b3aa;
        --border-subtle: #1f3325;
        --status-ok-bg: #0b5e2b;
        --status-ok-text: #d7ffe7;
        --status-warn-bg: #8a6a10;
        --status-warn-text: #fff5cc;
        --status-bad-bg: #7a1515;
        --status-bad-text: #ffe5e5;
      }

      * {
        box-sizing: border-box;
      }

      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: 980px;
        margin: 0 auto;
        padding: 0;
        background: radial-gradient(circle at top, #143825 0, #050b07 55%, #020403 100%);
        color: var(--text-main);
      }

      header {
        background: linear-gradient(90deg, var(--vr-green-dark), var(--vr-green));
        padding: 14px 20px;
        display: flex;
        align-items: center;
        gap: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }

      .logo-dot {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 16px;
        background: rgba(0,0,0,0.1);
      }

      header h1 {
        font-size: 20px;
        margin: 0;
      }

      header p {
        margin: 0;
        font-size: 13px;
        color: rgba(255,255,255,0.8);
      }

      main {
        padding: 20px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
      }

      .card {
        background: linear-gradient(145deg, var(--card-bg), #07120c);
        border-radius: 14px;
        padding: 16px 18px;
        border: 1px solid var(--border-subtle);
        box-shadow:
          0 14px 30px rgba(0,0,0,0.55),
          0 0 0 1px rgba(0,0,0,0.4);
        position: relative;
        overflow: hidden;
      }

      .card::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at top left, rgba(0,123,61,0.3), transparent 60%);
        opacity: 0.9;
        pointer-events: none;
      }

      .card-inner {
        position: relative;
        z-index: 1;
      }

      .card-header-line {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
      }

      .title {
        font-size: 16px;
        font-weight: 600;
      }

      .badge-direction {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(0,0,0,0.2);
      }

      .subtitle {
        font-size: 12px;
        color: var(--text-muted);
        margin-bottom: 12px;
      }

      .row-main,
      .second-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }

      .status-cell {
        display: flex;
        justify-content: flex-end;
      }

      .train-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-muted);
      }

      .time-big {
        font-size: 30px;
        font-weight: 600;
      }

      .train-number {
        font-size: 13px;
        color: var(--text-muted);
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
      }

      .status-ok {
        background: var(--status-ok-bg);
        color: var(--status-ok-text);
      }
      .status-warn {
        background: var(--status-warn-bg);
        color: var(--status-warn-text);
      }
      .status-bad {
        background: var(--status-bad-bg);
        color: var(--status-bad-text);
      }
      .status-pill span.icon {
        font-size: 14px;
      }

      .meta-line {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
      }

      .divider {
        margin: 10px 0 8px;
        border-top: 1px dashed rgba(255,255,255,0.14);
      }

      .second-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-muted);
        margin-bottom: 4px;
      }

      .second-time {
        font-size: 18px;
      }

      .second-meta {
        font-size: 11px;
        color: var(--text-muted);
      }

      .error {
        color: #ffb3b3;
        font-size: 12px;
        margin-top: 8px;
      }

      .loading {
        font-size: 12px;
        color: var(--text-muted);
      }

      @media (max-width: 600px) {
        header {
          padding: 12px 12px;
        }
        main {
          padding: 14px;
        }
        .time-big {
          font-size: 26px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="logo-dot">Z</div>
      <div>
        <h1>Z-junaseuranta</h1>
        <p>Reaaliaikainen Z-junien seuranta Helsingin ja Mäntsälän välillä</p>
      </div>
    </header>

    <main>
      <div class="grid">
        <!-- Helsinki-kortti -->
        <div class="card">
          <div class="card-inner">
            <div class="card-header-line">
              <div class="title">Helsingistä (HKI)</div>
              <div class="badge-direction">Z → Mäntsälä / Lahti</div>
            </div>
            <div class="subtitle">Seuraavat Z-junat Helsingistä pohjoiseen</div>

            <p id="loading-hki" class="loading">Haetaan tietoja...</p>

            <div id="content-hki" style="display:none;">
              <!-- Ensimmäinen juna -->
              <div class="train-label">SEURAAVA JUNA</div>
              <div class="row-main">
                <div>
                  <div class="time-big" id="time-hki">--:--</div>
                  <div class="train-number">
                    Juna <span id="trainNumber-hki">-</span>
                  </div>
                  <div class="meta-line" id="extra-hki"></div>
                </div>
                <div class="status-cell">
                  <div id="status-hki" class="status-pill status-ok"></div>
                </div>
              </div>

              <!-- Toinen juna -->
              <div id="second-hki" style="display:none;">
                <div class="divider"></div>
                <div class="second-label">seuraava juna</div>
                <div class="second-row">
                  <div>
                    <div class="second-time" id="time2-hki">--:--</div>
                    <div class="second-meta">
                      Juna <span id="trainNumber2-hki">-</span>
                    </div>
                  </div>
                  <div class="status-cell">
                    <div id="status2-hki" class="status-pill status-ok"></div>
                  </div>
                </div>
              </div>
            </div>

            <p class="error" id="error-hki"></p>
          </div>
        </div>

        <!-- Mäntsälä-kortti -->
        <div class="card">
          <div class="card-inner">
            <div class="card-header-line">
              <div class="title">Mäntsälästä (MLÄ)</div>
              <div class="badge-direction">Z → Helsinki</div>
            </div>
            <div class="subtitle">Seuraavat Z-junat Mäntsälästä Helsinkiin</div>

            <p id="loading-mantsala" class="loading">Haetaan tietoja...</p>

            <div id="content-mantsala" style="display:none;">
              <!-- Ensimmäinen juna -->
              <div class="train-label">SEURAAVA JUNA</div>
              <div class="row-main">
                <div>
                  <div class="time-big" id="time-mantsala">--:--</div>
                  <div class="train-number">
                    Juna <span id="trainNumber-mantsala">-</span>
                  </div>
                  <div class="meta-line" id="extra-mantsala"></div>
                </div>
                <div class="status-cell">
                  <div id="status-mantsala" class="status-pill status-ok"></div>
                </div>
              </div>

              <!-- Toinen juna -->
              <div id="second-mantsala" style="display:none;">
                <div class="divider"></div>
                <div class="second-label">seuraava juna</div>
                <div class="second-row">
                  <div>
                    <div class="second-time" id="time2-mantsala">--:--</div>
                    <div class="second-meta">
                      Juna <span id="trainNumber2-mantsala">-</span>
                    </div>
                  </div>
                  <div class="status-cell">
                    <div id="status2-mantsala" class="status-pill status-ok"></div>
                  </div>
                </div>
              </div>
            </div>

            <p class="error" id="error-mantsala"></p>
          </div>
        </div>
      </div>
    </main>

    <script>
      const STATION_HELSINKI = "HKI";
      const STATION_MANTSALA = "MLÄ";

      function formatStatusClassAndText(data) {
        if (data.cancelled) {
          return { cls: "status-pill status-bad", icon: "⛔", text: "Peruttu" };
        }
        if (data.delayMinutes >= 10) {
          return { cls: "status-pill status-bad", icon: "🔴", text: "Myöhässä " + data.delayMinutes + " min" };
        }
        if (data.delayMinutes > 0) {
          return { cls: "status-pill status-warn", icon: "🟡", text: "Myöhässä " + data.delayMinutes + " min" };
        }
        return { cls: "status-pill status-ok", icon: "🟢", text: "Aikataulussa" };
      }

      function formatTime(isoString) {
        const d = new Date(isoString);
        return d.toLocaleTimeString("fi-FI", {
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      async function loadNextTrains(stationCode, domKey, niceName, targetCode) {
        const loading = document.getElementById("loading-" + domKey);
        const content = document.getElementById("content-" + domKey);
        const errorEl = document.getElementById("error-" + domKey);
        const secondBox = document.getElementById("second-" + domKey);

        loading.style.display = "block";
        content.style.display = "none";
        errorEl.textContent = "";
        if (secondBox) {
          secondBox.style.display = "none";
        }

        try {
          let url = "/api/next-z-train?station=" + encodeURIComponent(stationCode) + "&count=2";
          if (targetCode) {
            url += "&target=" + encodeURIComponent(targetCode);
          }

          const res = await fetch(url);
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || "Tuntematon virhe");
          }

          const list = Array.isArray(data) ? data : [data];

          // Ensimmäinen juna
          const first = list[0];
          document.getElementById("trainNumber-" + domKey).textContent = first.trainNumber;
          document.getElementById("time-" + domKey).textContent = formatTime(first.scheduledTime);
          const status1 = formatStatusClassAndText(first);
          const statusEl1 = document.getElementById("status-" + domKey);
          statusEl1.className = status1.cls;
          statusEl1.innerHTML = '<span class="icon">' + status1.icon + '</span><span>' + status1.text + '</span>';
          document.getElementById("extra-" + domKey).textContent =
            "Päivämäärä: " + first.departureDate + " · Asema: " + niceName;

          // Toinen juna (jos löytyy)
          if (list.length > 1 && secondBox) {
            const second = list[1];
            document.getElementById("trainNumber2-" + domKey).textContent = second.trainNumber;
            document.getElementById("time2-" + domKey).textContent = formatTime(second.scheduledTime);
            const status2 = formatStatusClassAndText(second);
            const statusEl2 = document.getElementById("status2-" + domKey);
            statusEl2.className = status2.cls;
            statusEl2.innerHTML = '<span class="icon">' + status2.icon + '</span><span>' + status2.text + '</span>';
            secondBox.style.display = "block";
          }

          loading.style.display = "none";
          content.style.display = "block";
        } catch (err) {
          console.error(err);
          loading.style.display = "none";
          content.style.display = "none";
          errorEl.textContent = "Virhe haettaessa junatietoja: " + err.message;
        }
      }

      function refreshAll() {
        // HKI: kaikki Z-lähdöt pohjoiseen
        loadNextTrains(STATION_HELSINKI, "hki", "Helsinki (HKI)", null);
        // Mäntsälä: vain junat, jotka jatkavat Helsinkiin
        loadNextTrains(STATION_MANTSALA, "mantsala", "Mäntsälä (MLÄ)", STATION_HELSINKI);
      }

      // Lataa heti
      refreshAll();
      // Päivitä 30 sek välein
      setInterval(refreshAll, 30000);
    </script>
  </body>
</html>`);
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
