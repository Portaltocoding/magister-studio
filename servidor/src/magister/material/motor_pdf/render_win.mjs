// HTML a PDF con Chromium headless por CDP (sin dependencias npm). Patrón de tuio-tmp/ficha-maestra/render.mjs.
// Pasada 1 imprime; se buscan con pdftotext las páginas de cada título (.pg[data-for]); pasada 2 las rellena.
// Uso: node render.mjs <ficha.html> <salida.pdf> "<texto del pie>"
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [htmlPath, outArg, footer = ''] = process.argv.slice(2);
const html = pathToFileURL(resolve(htmlPath)).href;
const out = resolve(outArg);
const profile = mkdtempSync(join(tmpdir(), 'ficha-chrome-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method) waiters.filter((w) => w.method === m.method).forEach((w) => w.res(m.params));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(++id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

  await send('Page.enable');
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: html });
  await loaded;
  // KaTeX lo renderiza el propio HTML y deja window.__listo = true (o un texto de error).
  for (let i = 0; i < 200; i++) {
    const { result } = await evaluate('window.__listo');
    if (result.value === true) break;
    if (typeof result.value === 'string') throw new Error('KaTeX: ' + result.value);
    await sleep(100);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  const { result: kerr } = await evaluate('document.querySelectorAll(".katex-error").length');
  if (kerr.value) throw new Error(`${kerr.value} fórmulas con error de KaTeX`);

  const print = async () => {
    const { data } = await send('Page.printToPDF', {
      preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-family:Inter,Segoe UI,sans-serif;font-size:7.5px;color:#6b6b6b;width:100%;padding:0 17mm 0 17mm;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span>p. <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    writeFileSync(out, Buffer.from(data, 'base64'));
  };

  // Cada título indexado abre página: se busca la página (desde la 2) cuyo texto EMPIEZA por él.
  const norm = (s) => s.replace(/\s+/g, '');
  const findPages = async () => {
    const { result } = await evaluate(`JSON.stringify([...document.querySelectorAll('.pg')].map(e =>
      [e.dataset.for, document.getElementById(e.dataset.for).textContent,
       document.getElementById(e.dataset.for).dataset.etq || '']))`);
    const text = execFileSync('pdftotext', ['-enc','UTF-8',out, '-']).toString().split('\f').map(norm);
    const filas = JSON.parse(result.value);
    // Las páginas del índice contienen todos los títulos: se reconocen porque tienen el primero y el último.
    const t0 = filas.length ? norm(filas[0][1]) : '', tN = filas.length ? norm(filas[filas.length - 1][1]) : '';
    const esIndice = (p) => filas.length > 1 && p.includes(t0) && p.includes(tN);
    // Los títulos van en orden de documento: cada uno se busca a partir de la página del anterior.
    let desde = 1;
    return Object.fromEntries(filas.map(([key, title, etq]) => {
      const t = norm(title);
      // La etiqueta ({etq}) se pinta con ::before y sale en el texto delante del título.
      const te = norm(etq + title).toLowerCase();
      const vale = (p, i) => i >= desde && !esIndice(p);
      let idx = text.findIndex((p, i) => vale(p, i) && (p.startsWith(t) || (etq && p.toLowerCase().startsWith(te))));
      // Títulos que no abren página ({.nb}): el primero que lo contenga a partir del anterior.
      if (idx < 0) idx = text.findIndex((p, i) => vale(p, i) && p.includes(t));
      if (idx < 0) idx = text.findIndex((p, i) => i >= 1 && !esIndice(p) && p.includes(t));
      if (idx < 0) throw new Error(`título no encontrado en el PDF: ${t}`);
      desde = idx;
      return [key, idx + 1];
    }));
  };
  const fill = (m) => evaluate(`(() => { const m = ${JSON.stringify(m)};
    document.querySelectorAll('.pg').forEach(e => { e.textContent = m[e.dataset.for]; }); return true; })()`);

  await print();
  let prev = await findPages();
  for (let k = 0; k < 4; k++) {
    await fill(prev);
    await print();
    const next = await findPages();
    if (JSON.stringify(next) === JSON.stringify(prev)) { prev = null; break; }
    prev = next;
  }
  if (prev) throw new Error('el índice no converge');
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
