'use strict';
// Documentation previews only: synthetic data, no Homey or Voldt connections.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const nl = require('../../locales/nl.json');
const driverIcon = fs.readFileSync(path.join(root, 'drivers/voldt/assets/icon.svg'), 'utf8');
const encode = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const shim = `window.Homey={
  __(key){return key.split('.').reduce((v,k)=>v?.[k],${encode(nl)})||key;},
  setTitle(){},ready(){},done(){},showView(){},
  async emit(){return {found:1};},
  api(method,route,body,callback){const values={
    '/devices':[{key:'example-device',name:'Voldt laadkabel',configured:true}],
    '/account/login':{token:'synthetic-preview-session'},
    '/account/find':{devices:[{id:'example-cable',name:'Voldt laadkabel',host:'192.168.1.50'}]},
    '/account/configure':{configured:true},'/account/logout':true};
    queueMicrotask(()=>callback(null,values[route]));}
};document.addEventListener('DOMContentLoaded',()=>{
  window.onHomeyReady?.(Homey);
  document.getElementById('email').placeholder='gebruiker@example.test';
  document.getElementById('password').placeholder='Je Voldt-wachtwoord';
});`;
function sourceView(kind) {
  if (kind === 'pair') return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><script>'+shim+'</script></head><body>'+fs.readFileSync(path.join(root, 'drivers/voldt/pair/setup.html'), 'utf8')+'</body></html>';
  return fs.readFileSync(path.join(root, 'settings/index.html'), 'utf8');
}
const titles = { pair: ['Eenmalig aanmelden', 'Koppelen met je Voldt-account', 'Originele appinterface · demoweergave'],
  settings: ['Bestaande koppeling herstellen', 'Je tegel en Flows behouden', 'Originele appinterface · demoweergave'],
  device: ['Je laadkabel in één oogopslag', 'Bedienen en meten vanuit Homey', 'Illustratief paneel · voorbeeldwaarden'] };
function shell(kind) {
  const [title, subtitle, note] = titles[kind];
  const content = kind === 'device' ? device() : `<iframe title="Voldt-appinterface" src="/source/${kind}"></iframe>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#edf3fa;color:#173556;font-family:Segoe UI,Arial,sans-serif;width:720px;min-height:1120px;padding:42px 42px 30px}.eyebrow{font-size:12px;letter-spacing:2px;font-weight:700;color:#527a9f;text-transform:uppercase}h1{font-size:30px;letter-spacing:-1px;margin:12px 0 10px;line-height:1.2}.subtitle{font-size:16px;color:#607d9b;margin:0 0 27px}.window{background:white;border:1px solid #ccdaea;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px #1c46751c}.bar{height:58px;border-bottom:1px solid #e8edf5;display:flex;align-items:center;padding:0 20px;gap:10px;font-size:14px;font-weight:600}.bar svg{width:27px;height:27px}.bar .badge{margin-left:auto;background:#eef4fb;color:#527596;border-radius:20px;padding:5px 10px;font-size:11px;font-weight:600}iframe{width:100%;height:795px;border:0;display:block}.note{font-size:12px;color:#6b8198;margin-top:20px;line-height:1.6}.note strong{color:#426684}.device{padding:24px}.device h2{font-size:25px;margin:0}.zone{font-size:14px;color:#7e91a4;margin:7px 0 20px}.state{display:flex;align-items:center;gap:8px;background:#e9f7f2;color:#287760;border-radius:12px;padding:12px 15px;font-size:14px}.dot{width:7px;height:7px;border-radius:50%;background:#36b58e}.toggle{margin-top:20px;display:flex;justify-content:space-between;align-items:center;border:1px solid #e2eaf4;border-radius:16px;padding:20px;font-weight:600}.toggle small{display:block;font-size:13px;color:#7890a8;font-weight:400;margin-top:6px}.switch{width:50px;height:30px;border-radius:20px;background:#2576d6;padding:4px}.switch:after{content:'';display:block;background:white;border-radius:50%;width:22px;height:22px;margin-left:20px}.power{margin:18px 0;padding:26px;border-radius:18px;background:#12375c;color:white}.power label{font-size:14px;color:#aecbe7}.power .value{font-size:48px;font-weight:650;letter-spacing:-1px;margin:12px 0 0}.power .value span{font-size:21px;color:#9cbfdd;font-weight:400}.power .sub{font-size:13px;margin-top:8px;color:#a4c8e8}.meters{display:grid;grid-template-columns:1fr 1fr;gap:12px}.meter{border:1px solid #e0e9f4;border-radius:15px;padding:17px}.meter label{font-size:12px;line-height:1.4;color:#7b8da1;display:block}.meter strong{font-size:23px;display:block;margin:10px 0 2px}.meter strong span{font-size:14px;font-weight:400;color:#7890a8}.meter .unitnote{font-size:10px;color:#7d94ab}.bottom{margin-top:19px;padding:13px 15px;background:#f2f6fc;border-radius:12px;font-size:12px;color:#7a91a9;line-height:1.6}
  </style></head><body><div class="eyebrow">Voldt voor Homey · community-app</div><h1>${title}</h1><p class="subtitle">${subtitle}</p><div class="window"><div class="bar">${driverIcon}Voldt<span class="badge">VOORBEELD</span></div>${content}</div><p class="note"><strong>${note}.</strong><br>Geen persoonlijke gegevens. De Homey-omlijsting kan per versie verschillen.</p></body></html>`;
}
function device() {
  return `<main class="device"><h2>Voldt laadkabel</h2><p class="zone">Buiten · Voldt</p><div class="state"><span class="dot"></span>Aan het laden</div><div class="toggle"><div>Laadschakelaar<small>Laden toegestaan</small></div><span class="switch"></span></div><div class="power"><label>Actueel laadvermogen</label><div class="value">2.800 <span>W</span></div><div class="sub">2,8 kW · voorbeeldwaarde</div></div><div class="meters"><div class="meter"><label>Totaal geladen energie</label><strong>42,80 <span>kWh</span></strong></div><div class="meter"><label>Energie laadbeurt</label><strong>1,24 <span>kWh</span></strong></div><div class="meter"><label>Kabeltemperatuur</label><strong>21 <span>°C</span></strong></div><div class="meter"><label>Ingestelde stroom</label><strong>13 <span>A</span></strong><div class="unitnote">Stroomlimiet, geen stroommeting</div></div></div><div class="bottom">Standaard elke 15 seconden bijgewerkt.<br>Werkelijke beschikbaarheid van metingen hangt af van de kabel.</div></main>`;
}
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'");
  if (pathname === '/homey.js') { response.setHeader('Content-Type', 'application/javascript; charset=utf-8'); response.end(shim); return; }
  const kind = pathname.slice(1);
  if (Object.hasOwn(titles, kind)) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(shell(kind)); return; }
  const match = pathname.match(/^\/source\/(pair|settings)$/);
  if (match) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(sourceView(match[1])); return; }
  response.writeHead(404); response.end('Not found');
});
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log(`Documentation previews: http://127.0.0.1:${server.address().port}`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
