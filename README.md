# Z-junaseuranta

Reaaliaikainen Z-junien seurantasovellus Helsingin (HKI) ja Mäntsälän (MLÄ) välillä.
Käyttää Digitrafficin avointa rajapintaa ja näyttää seuraavat kaksi Z-junaa molemmista suunnista.

## Teknologia

- Node.js
- Express
- Digitraffic API (`https://rata.digitraffic.fi/api/v1`)
- Yksi `index.js` -palvelin, joka palvelee myös frontend-HTML:n

## Käyttö lokaalisti

```bash
npm install
npm start
# selaimessa: http://localhost:3000
"# zjuna" 
