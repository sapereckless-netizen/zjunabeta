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

// Hakee useamman seuraavan Z-junan tietylle asemalle
async function getNextZTrainsFromStation(stationCode, targetCode, limit) {
  const zTrains = await fetchZTrainsToday();
  const now = new Date();
  const departures = [];

  zTrains.forEach((train) => {
    const rows = train.timeTableRows || [];

    const departIndex = rows.findIndex(
      (r) => r.stationShortCode === stationCode && r.type === "DEPARTURE"
    );
    if (departIndex === -1) return;

    if (targetCode) {
      const targetIndex = rows.findIndex((r) => r.stationShortCode === targetCode);
      if (targetIndex === -1 || targetIndex <= departIndex) return;
    }

    const row = rows[departIndex];
    const scheduledTime = new Date(row.scheduledTime);

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

  if (departures.length === 0) return [];

  departures.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
  return departures.slice(0, limit);
}

// API: seuraavat Z-junat
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

    if (count === 1) return res.json(list[0]);
    res.json(list);

  } catch (err) {
    console.error("Virhe junatiedoissa:", err);
    res.status(500).json({ error: "Virhe junatiedoissa" });
  }
});

// Etusivu
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Z-junaseuranta</title>

<style>
/* ---------- VR-teema ---------- */
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

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0 auto;
  max-width: 980px;
  padding: 0;
  background: radial-gradient(circle at top, #143825 0%, #050b07 55%, #020403 100%);
  color: var(--text-main);
}

header {
  background: linear-gradient(90deg, var(--vr-green-dark), var(--vr-green));
  padding: 14px 20px;
  display: flex;
  gap: 14px;
  align-items: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

.logo-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 20px;
}

header p {
  margin: 0;
  font-size: 13px;
  color: rgba(255,255,255,0.8);
}

main { padding: 20px; }

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
  box-shadow: 0 14px 30px rgba(0,0,0,0.5);
}

.card-header-line {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.title { font-size: 16px; font-weight: 600; }

.badge-direction {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
}

.subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.row-main,
.second-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
}

.status-cell {
  display: flex;
  justify-content: flex-end;
}

.time-big {
  font-size: 30px;
  font-weight: 600;
}

.status-pill {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.status-ok { background: var(--status-ok-bg); color: var(--status-ok-text); }
.status-warn { background: var(--status-warn-bg); color: var(--status-warn-text); }
.status-bad { background: var(--status-bad-bg); color: var(--status-bad-text); }

footer {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px 0 30px;
  opacity: 0.8;
}

/* ---------- MOBIILIOPTIMOINTI ---------- */
@media (max-width: 600px) {
  .grid { grid-template-columns: 1fr; gap: 14px; }
  .time-big { font-size: 36px; }
  .status-pill { font-size: 14px; padding: 6px 12px; }
}
</style>
</head>

<body>
<header>
  <div class="logo-dot">Z</div>
  <div>
    <h1>Z-junaseuranta</h1>
    <p>Reaaliaikaiset Z-junat Helsingin ja Mäntsälän välillä</p>
  </div>
</header>

<main>
<div class="grid">

<!-- Helsinki-kortti -->
<div class="card">
  <div class="card-header-line">
    <div class="title">Helsingistä (HKI)</div>
    <div class="badge-direction">Z → Mäntsälä / Lahti</div>
  </div>
  <div class="subtitle">Seuraavat Z-junat Helsingistä</div>

  <p id="loading-hki">Haetaan tietoja...</p>
  <div id="content-hki" style="display:none;">
    <div class="row-main">
      <div>
        <div class="time-big" id="time-hki">--:--</div>
        <div>Juna <span id="trainNumber-hki">-</span></div>
        <div class="meta-line" id="extra-hki"></div>
      </div>
      <div class="status-cell"><div id="status-hki" class="status-pill"></div></div>
    </div>

    <div id="second-hki" style="display:none;">
      <hr class="divider" />
      <div class="second-row">
        <div>
          <div class="second-time" id="time2-hki">--:--</div>
          <div>Juna <span id="trainNumber2-hki">-</span></div>
        </div>
        <div class="status-cell"><div id="status2-hki" class="status-pill"></div></div>
      </div>
    </div>
  </div>

  <p class="error" id="error-hki"></p>
</div>

<!-- Mäntsälä-kortti -->
<div class="card">
  <div class="card-header-line">
    <div class="title">Mäntsälästä (MLÄ)</div>
    <div class="badge-direction">Z → Helsinki</div>
  </div>
  <div class="subtitle">Seuraavat Z-junat Mäntsälästä</div>

  <p id="loading-mantsala">Haetaan tietoja...</p>
  <div id="content-mantsala" style="display:none;">
    <div class="row-main">
      <div>
        <div class="time-big" id="time-mantsala">--:--</div>
        <div>Juna <span id="trainNumber-mantsala">-</span></div>
        <div class="meta-line" id="extra-mantsala"></div>
      </div>
      <div class="status-cell"><div id="status-mantsala" class="status-pill"></div></div>
    </div>

    <div id="second-mantsala" style="display:none;">
      <hr class="divider" />
      <div class="second-row">
        <div>
          <div class="second-time" id="time2-mantsala">--:--</div>
          <div>Juna <span id="trainNumber2-mantsala">-</span></div>
        </div>
        <div class="status-cell"><div id="status2-mantsala" class="status-pill"></div></div>
      </div>
    </div>
  </div>

  <p class="error" id="error-mantsala"></p>
</div>

</div>
</main>

<footer>
  © Sauli Tähkäpää 2025
</footer>

<script>
const STATION_HELSINKI = "HKI";
const STATION_MANTSALA = "MLÄ";

function formatStatusClassAndText(data) {
  if (data.cancelled) return { cls: "status-pill status-bad", icon: "⛔", text: "Peruttu" };
  if (data.delayMinutes >= 10) return { cls: "status-pill status-bad", icon: "🔴", text: "Myöhässä " + data.delayMinutes + " min" };
  if (data.delayMinutes > 0) return { cls: "status-pill status-warn", icon: "🟡", text: "Myöhässä " + data.delayMinutes + " min" };
  return { cls: "status-pill status-ok", icon: "🟢", text: "Aikataulussa" };
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
}

async function loadNextTrains(stationCode, domKey, niceName, targetCode) {
  const loading = document.getElementById("loading-" + domKey);
  const content = document.getElementById("content-" + domKey);
  const errorEl = document.getElementById("error-" + domKey);
  const secondBox = document.getElementById("second-" + domKey);

  loading.style.display = "block";
  content.style.display = "none";
  errorEl.textContent = "";
  if (secondBox) secondBox.style.display = "none";

  try {
    let url = "/api/next-z-train?station=" + stationCode + "&count=2";
    if (targetCode) url += "&target=" + targetCode;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Tuntematon virhe");

    const list = Array.isArray(data) ? data : [data];

    const first = list[0];
    document.getElementById("trainNumber-" + domKey).textContent = first.trainNumber;
    document.getElementById("time-" + domKey).textContent = formatTime(first.scheduledTime);
    const st1 = formatStatusClassAndText(first);
    const statusEl1 = document.getElementById("status-" + domKey);
    statusEl1.className = st1.cls;
    statusEl1.innerHTML = st1.icon + " " + st1.text;
    document.getElementById("extra-" + domKey).textContent = "Päivämäärä: " + first.departureDate;

    if (list.length > 1) {
      const second = list[1];
      document.getElementById("trainNumber2-" + domKey).textContent = second.trainNumber;
      document.getElementById("time2-" + domKey).textContent = formatTime(second.scheduledTime);
      const st2 = formatStatusClassAndText(second);
      const statusEl2 = document.getElementById("status2-" + domKey);
      statusEl2.className = st2.cls;
      statusEl2.innerHTML = st2.icon + " " + st2.text;
      secondBox.style.display = "block";
    }

    loading.style.display = "none";
    content.style.display = "block";
  } catch (err) {
    loading.style.display = "none";
    errorEl.textContent = "Virhe haettaessa junatietoja: " + err.message;
  }
}

function refreshAll() {
  loadNextTrains(STATION_HELSINKI, "hki", "Helsinki (HKI)", null);
  loadNextTrains(STATION_MANTSALA, "mantsala", "Mäntsälä (MLÄ)", STATION_HELSINKI);
}

refreshAll();
setInterval(refreshAll, 30000);
</script>

</body>
</html>`);
});

// Käynnistä palvelin
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
