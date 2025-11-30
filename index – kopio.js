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
// Esim:
//  /api/next-z-train?station=HKI&count=2
//  /api/next-z-train?station=MLÄ&target=HKI&count=2  (Mäntsälä -> Helsinki)
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

    // Jos pyydettiin vain yhtä, palautetaan yksittäinen objekti (taaksepäinyhteensopivuus)
    if (count === 1) {
      return res.json(list[0]);
    }

    // Muuten palautetaan lista
    res.json(list);
  } catch (err) {
    console.error("Virhe junatiedoissa:", err);
    res.status(500).json({ error: "Virhe junatiedoissa" });
  }
});

// Etusivu: näyttää molemmista suunnista 2 seuraavaa junaa
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fi">
  <head>
    <meta charset="UTF-8" />
    <title>Z-junaseuranta</title>
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: 900px;
        margin: 40px auto;
        padding: 16px;
      }
      h1 {
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
      }
      .card {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 16px;
      }
      .title {
        font-size: 20px;
        margin-bottom: 4px;
      }
      .subtitle {
        font-size: 14px;
        color: #555;
        margin-bottom: 12px;
      }
      .status {
        margin-top: 4px;
        font-weight: bold;
      }
      .small {
        color: #555;
        font-size: 14px;
      }
      .error {
        color: red;
        font-size: 14px;
        margin-top: 8px;
      }
      .second {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px dashed #ccc;
      }
    </style>
  </head>
  <body>
    <h1>Z-junaseuranta</h1>
    <div class="grid">
      <!-- Helsinki-kortti -->
      <div class="card">
        <div class="title">Helsingistä (HKI) lähtevät Z-junat</div>
        <div class="subtitle">Suunta Mäntsälä / Lahti</div>
        <p id="loading-hki">Haetaan tietoja...</p>
        <div id="content-hki" style="display:none;">
          <div>
            <p><strong>Seuraava juna:</strong> <span id="trainNumber-hki"></span></p>
            <p><strong>Lähtöaika:</strong> <span id="time-hki"></span></p>
            <p class="status" id="status-hki"></p>
            <p class="small" id="extra-hki"></p>
          </div>
          <div id="second-hki" class="second" style="display:none;">
            <p><strong>seuraava juna:</strong> <span id="trainNumber2-hki"></span></p>
            <p>Lähtöaika: <span id="time2-hki"></span></p>
            <p class="status" id="status2-hki"></p>
          </div>
        </div>
        <p class="error" id="error-hki"></p>
      </div>

      <!-- Mäntsälä-kortti -->
      <div class="card">
        <div class="title">Mäntsälästä (MLÄ) lähtevät Z-junat</div>
        <div class="subtitle">Suunta Helsinki</div>
        <p id="loading-mantsala">Haetaan tietoja...</p>
        <div id="content-mantsala" style="display:none;">
          <div>
            <p><strong>Seuraava juna:</strong> <span id="trainNumber-mantsala"></span></p>
            <p><strong>Lähtöaika:</strong> <span id="time-mantsala"></span></p>
            <p class="status" id="status-mantsala"></p>
            <p class="small" id="extra-mantsala"></p>
          </div>
          <div id="second-mantsala" class="second" style="display:none;">
            <p><strong>seuraava juna:</strong> <span id="trainNumber2-mantsala"></span></p>
            <p>Lähtöaika: <span id="time2-mantsala"></span></p>
            <p class="status" id="status2-mantsala"></p>
          </div>
        </div>
        <p class="error" id="error-mantsala"></p>
      </div>
    </div>

    <p class="small" style="margin-top:24px;">
      Tiedot päivittyvät automaattisesti 30 sekunnin välein.
    </p>

    <script>
      const STATION_HELSINKI = "HKI";
      const STATION_MANTSALA = "MLÄ";

      function formatStatusText(data) {
        if (data.cancelled) {
          return "Juna on peruttu";
        } else if (data.delayMinutes > 0) {
          return "Myöhässä " + data.delayMinutes + " min";
        } else {
          return "Aikataulussa";
        }
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
          document.getElementById("status-" + domKey).textContent = formatStatusText(first);
          document.getElementById("extra-" + domKey).textContent =
            "Päivämäärä: " + first.departureDate + " · Asema: " + niceName;

          // Toinen juna (jos löytyy)
          if (list.length > 1 && secondBox) {
            const second = list[1];
            document.getElementById("trainNumber2-" + domKey).textContent = second.trainNumber;
            document.getElementById("time2-" + domKey).textContent = formatTime(second.scheduledTime);
            document.getElementById("status2-" + domKey).textContent = formatStatusText(second);
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
        // HKI: kaikki Z-lähdöt
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
