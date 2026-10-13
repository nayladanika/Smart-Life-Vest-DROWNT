/* ============================================================================
   PingerPanel.jsx — modul beacon akustik DROWNT
   Letakkan di: dashboard/src/components/PingerPanel.jsx

   Komponen ini mandiri: CSS-nya ikut di dalam file, semua class diawali
   .dpg- supaya tidak bentrok dengan styling dashboard yang sudah ada.
   Tidak butuh library tambahan dan tidak butuh perubahan konfigurasi Vite.

   PEMAKAIAN
     import PingerPanel from "./components/PingerPanel";

     // Tanpa data nyata, komponen jalan dalam mode simulasi:
     <PingerPanel />

     // Dengan data dari telemetri yang sudah ada:
     <PingerPanel telemetry={{
       submerged: data.vit.sub === 1,
       loraOk:    Date.now() - lastPacketTime < 10000,
       strength:  acousticStrength,   // 0-100, dari unit rescuer
       groups:    acousticGroups,
       lat: data.gps.lat, lon: data.gps.lng,
       fixTime: lastFixTimestamp,
     }} />
   ============================================================================ */

import { useEffect, useRef, useState, useCallback } from "react";

const SVC = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHR = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

const TEXT = {
  surface: ["PERMUKAAN — LoRa aktif",
    "Rompi di permukaan. Telemetri dikirim normal, pinger siaga."],
  lost: ["SINYAL LORA HILANG",
    "Paket terakhir lebih dari 10 detik lalu. Pinger belum diaktifkan."],
  pinging: ["TERENDAM — PINGER AKTIF",
    "RF tidak dapat menembus air. Beacon akustik 40 kHz menjadi satu-satunya kanal."],
  contact: ["KONTAK AKUSTIK",
    "Hidrofon rescuer menangkap pola 3 ping. Ikuti arah yang membuat angka naik."],
  close: ["SANGAT DEKAT",
    "Sinyal kuat. Korban berada dalam radius dekat dari posisi hidrofon."],
};

const secs = (ms) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
};

export default function PingerPanel({ telemetry }) {
  const [st, setSt] = useState({
    submerged: false, loraOk: true, strength: 0, groups: 0,
    pingerSince: null, lastFix: null,
  });
  const [audioOn, setAudioOn] = useState(false);
  const [src, setSrc] = useState("simulasi");
  const [, tick] = useState(0);          // memaksa render agar timer berjalan

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);           // AudioContext
  const nextPingRef = useRef(0);
  const stRef = useRef(st);
  const simRef = useRef(null);
  stRef.current = st;

  /* ---------- terima data dari luar ---------- */
  useEffect(() => {
    if (!telemetry) return;
    setSt((p) => {
      const n = { ...p };
      if ("submerged" in telemetry) {
        if (telemetry.submerged && !p.submerged) n.pingerSince = Date.now();
        if (!telemetry.submerged) n.pingerSince = null;
        n.submerged = !!telemetry.submerged;
      }
      if ("loraOk" in telemetry) n.loraOk = !!telemetry.loraOk;
      if ("strength" in telemetry) n.strength = Math.max(0, Math.min(100, telemetry.strength | 0));
      if ("groups" in telemetry) n.groups = telemetry.groups | 0;
      if (telemetry.lat && telemetry.lon)
        n.lastFix = { lat: +telemetry.lat, lon: +telemetry.lon, t: telemetry.fixTime || Date.now() };
      return n;
    });
  }, [telemetry]);

  /* ---------- state turunan ---------- */
  const state = st.submerged
    ? (st.strength >= 70 ? "close" : st.strength > 5 ? "contact" : "pinging")
    : (!st.loraOk ? "lost" : "surface");
  const live = state === "contact" || state === "close";

  /* ---------- timer 1 detik agar umur data terus berjalan ---------- */
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* ---------- audio ping ---------- */
  const enableAudio = useCallback(() => {
    if (ctxRef.current) { ctxRef.current.resume(); setAudioOn(true); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctxRef.current = new AC();
    setAudioOn(true);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const ctx = ctxRef.current;
      const s = stRef.current;
      if (!ctx || ctx.state !== "running") return;
      const alive = s.submerged && s.strength > 5;
      if (!alive) return;
      const now = performance.now();
      if (now < nextPingRef.current) return;
      // Makin kuat sinyal, makin rapat bunyi: 100% -> 140 ms, 0% -> 1100 ms
      nextPingRef.current = now + (1100 - (s.strength / 100) * 960);

      // Nada 2 kHz pendek. Sinyal asli 40 kHz di luar jangkauan telinga,
      // jadi diturunkan ke rentang audio persis seperti di unit rescuer.
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const amp = 0.35 + (s.strength / 100) * 0.65;
      osc.type = "sine";
      osc.frequency.setValueAtTime(2000, t);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28 * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(g).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.1);
    }, 40);
    return () => clearInterval(id);
  }, []);

  /* ---------- sonar scope ---------- */
  useEffect(() => {
    let raf, sweep = 0;
    const draw = () => {
      const c = canvasRef.current;
      if (c) {
        const x = c.getContext("2d");
        const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = W / 2 - 14;
        const s = stRef.current;
        const on = s.submerged;
        x.clearRect(0, 0, W, H);

        x.strokeStyle = "#17303a"; x.lineWidth = 2;
        [0.33, 0.66, 1].forEach((f) => { x.beginPath(); x.arc(cx, cy, R * f, 0, 6.2832); x.stroke(); });
        x.beginPath(); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R);
        x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke();

        if (on) {
          sweep += 0.03;
          if (x.createConicGradient) {
            const grad = x.createConicGradient(sweep, cx, cy);
            grad.addColorStop(0, "rgba(0,229,199,0.34)");
            grad.addColorStop(0.14, "rgba(0,229,199,0)");
            grad.addColorStop(1, "rgba(0,229,199,0)");
            x.fillStyle = grad;
            x.beginPath(); x.arc(cx, cy, R, 0, 6.2832); x.fill();
          }
          if (s.strength > 0) {
            const rr = R * (1 - s.strength / 100) * 0.85 + 10;
            const ang = sweep * 0.6;
            const bx = cx + Math.cos(ang) * rr, by = cy + Math.sin(ang) * rr;
            x.beginPath(); x.arc(bx, by, 9, 0, 6.2832); x.fillStyle = "#00e5c7"; x.fill();
            x.beginPath(); x.arc(bx, by, 17, 0, 6.2832);
            x.strokeStyle = "rgba(0,229,199,0.4)"; x.lineWidth = 2; x.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- BLE ke unit rescuer ---------- */
  const connectBle = async () => {
    if (!navigator.bluetooth) { setSrc("BLE tidak didukung"); return; }
    try {
      setSrc("menyambung...");
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Pinger" }], optionalServices: [SVC],
      });
      const server = await dev.gatt.connect();
      const ch = await (await server.getPrimaryService(SVC)).getCharacteristic(CHR);
      await ch.startNotifications();
      ch.addEventListener("characteristicvaluechanged", (e) => {
        let d; try { d = JSON.parse(new TextDecoder().decode(e.target.value)); } catch { return; }
        setSt((p) => ({
          ...p, submerged: true, loraOk: false,
          strength: Math.max(0, Math.min(100, d.st | 0)),
          groups: d.gr | 0,
          pingerSince: p.pingerSince || Date.now(),
        }));
      });
      dev.addEventListener("gattserverdisconnected", () => setSrc("terputus"));
      setSrc(dev.name || "PingerRX");
      stopSim();
    } catch (err) {
      if (err?.name !== "NotFoundError") console.error(err);
      setSrc("simulasi");
    }
  };

  /* ---------- simulasi demo ---------- */
  const stopSim = () => { if (simRef.current) { clearInterval(simRef.current); simRef.current = null; } };
  useEffect(() => stopSim, []);

  const runSim = () => {
    stopSim();
    let t = 0;
    setSt({
      submerged: false, loraOk: true, strength: 0, groups: 0, pingerSince: null,
      lastFix: { lat: -6.3627, lon: 106.8272, t: Date.now() },
    });
    simRef.current = setInterval(() => {
      t++;
      setSt((p) => {
        if (t < 4) return { ...p, loraOk: false };
        if (t < 9) return { ...p, submerged: true, loraOk: false, strength: 0,
                            pingerSince: p.pingerSince || Date.now() };
        const s = Math.min(96, (t - 8) * 7);
        if (s >= 96) stopSim();
        return { ...p, strength: s, groups: Math.floor((t - 8) / 2) };
      });
    }, 1000);
  };

  const reset = () => {
    stopSim();
    setSt({ submerged: false, loraOk: true, strength: 0, groups: 0, pingerSince: null, lastFix: null });
    setSrc("simulasi");
  };

  /* ---------- nilai tampilan ---------- */
  const [name, desc] = TEXT[state];
  const dist = live ? Math.round(120 * Math.pow(1 - st.strength / 100, 1.6)) + 3 : null;
  const fixAge = st.lastFix ? Math.floor((Date.now() - st.lastFix.t) / 1000) : null;
  const pulse = st.strength > 0 ? (1.4 - (st.strength / 100) * 1.15).toFixed(2) : 1.4;

  const V = ({ children, tone }) => (
    <span className={`dpg-v${tone ? " dpg-" + tone : ""}`}>{children}</span>
  );
  const Row = ({ k, children }) => (
    <div className="dpg-row"><span className="dpg-k">{k}</span>{children}</div>
  );

  return (
    <div className="dpg-root" data-state={state} style={{ "--dpg-rate": `${pulse}s` }}>
      <style>{CSS}</style>

      <div className="dpg-head">
        <h2>ACOUSTIC PINGER</h2>
        <span className="dpg-sub">40 kHz · beacon bawah air</span>
        <span className="dpg-sp" />
        <span className="dpg-sub">sumber: {src}</span>
      </div>

      <div className="dpg-state">
        <span className="dpg-dot" />
        <span className="dpg-name">{name}</span>
        <span className="dpg-desc">{desc}</span>
      </div>

      <div className="dpg-grid">
        <div className="dpg-card">
          <p className="dpg-cap">KEKUATAN SINYAL AKUSTIK</p>
          <div className="dpg-scope">
            <canvas ref={canvasRef} width={520} height={520} />
            <div className="dpg-scopeval">
              <b>{live ? st.strength : "--"}</b><span>PERSEN</span>
            </div>
          </div>
          <div className="dpg-meter">
            <div className="dpg-fill" style={{
              width: `${live ? st.strength : 0}%`,
              background: st.strength >= 70 ? "var(--cy)" : st.strength >= 35 ? "var(--amb)" : "var(--blu)",
            }} />
            <div className="dpg-ticks">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>
          </div>
          <Row k="PERKIRAAN JARAK">
            <V tone={dist == null ? "off" : dist < 15 ? "ok" : dist < 50 ? "warn" : null}>
              {dist == null ? "--" : `± ${dist} m`}
            </V>
          </Row>
          <Row k="GRUP PING TERDETEKSI">
            <V tone={st.groups > 0 ? "ok" : "off"}>{st.groups}</V>
          </Row>
        </div>

        <div className="dpg-card">
          <p className="dpg-cap">STATUS BEACON</p>
          <Row k="PINGER">
            <V tone={st.submerged ? "bad" : "off"}>{st.submerged ? "MEMANCAR" : "SIAGA"}</V>
          </Row>
          <Row k="POLA">
            <V>{st.submerged ? "5 ping / 1 dtk (alarm)" : "3 ping / 2 dtk"}</V>
          </Row>
          <Row k="AKTIF SEJAK">
            <V tone={st.pingerSince ? "bad" : "off"}>
              {st.pingerSince ? secs(Date.now() - st.pingerSince) : "--"}
            </V>
          </Row>
          <Row k="LORA">
            <V tone={st.loraOk ? "ok" : "bad"}>{st.loraOk ? "TERHUBUNG" : "TERPUTUS"}</V>
          </Row>

          <p className="dpg-cap" style={{ margin: "18px 0 12px" }}>POSISI TERAKHIR DIKETAHUI</p>
          <Row k="KOORDINAT">
            <V>{st.lastFix ? (
              <a href={`https://www.google.com/maps?q=${st.lastFix.lat},${st.lastFix.lon}`}
                 target="_blank" rel="noopener noreferrer">
                {st.lastFix.lat.toFixed(5)}, {st.lastFix.lon.toFixed(5)}
              </a>
            ) : "--"}</V>
          </Row>
          <Row k="UMUR DATA">
            <V tone={fixAge == null ? "off" : fixAge > 60 ? "bad" : fixAge > 20 ? "warn" : "ok"}>
              {fixAge == null ? "--" : secs(fixAge * 1000)}
            </V>
          </Row>
          <Row k="RADIUS DRIFT">
            <V tone={fixAge == null ? "off" : fixAge > 60 ? "bad" : "warn"}>
              {fixAge == null ? "--" : `± ${Math.round(fixAge * 0.51)} m`}
            </V>
          </Row>

          <div className="dpg-btns">
            <button className={audioOn ? "" : "dpg-go"} onClick={enableAudio}>
              {audioOn ? "Audio aktif" : "Aktifkan audio ping"}
            </button>
            <button onClick={connectBle}>Hubungkan PingerRX</button>
          </div>
          <div className="dpg-btns">
            <button className="dpg-arm" onClick={runSim}>Simulasi: korban tenggelam</button>
            <button onClick={reset}>Reset</button>
          </div>
        </div>
      </div>

      <p className="dpg-note">
        Audio ping disintesis di browser. Lajunya mengikuti kekuatan sinyal akustik,
        sama seperti bunyi di unit rescuer. Browser memblokir suara sampai ada
        interaksi, jadi tekan <strong>Aktifkan audio ping</strong> sekali di awal.
      </p>
    </div>
  );
}

/* ===================================================================== */
const CSS = `
.dpg-root{
  --bg:#050a0e; --panel:#0b1419; --panel2:#0f1d24; --line:#1b3038;
  --ink:#dceaef; --mute:#6d8c97; --dim:#3d5a66;
  --cy:#00e5c7; --amb:#ffb340; --red:#ff3b30; --blu:#3c9ddd;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
  font-family:system-ui,-apple-system,sans-serif; color:var(--ink);
  background:var(--bg); padding:18px; border:1px solid var(--line); border-radius:4px;
}
.dpg-root *{box-sizing:border-box}
.dpg-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.dpg-head h2{font:600 13px var(--mono);letter-spacing:.14em;margin:0;color:var(--cy)}
.dpg-head .dpg-sub{font:11px var(--mono);color:var(--mute);letter-spacing:.06em}
.dpg-head .dpg-sp{margin-left:auto}
.dpg-state{border:1px solid var(--line);border-left-width:3px;background:var(--panel);
  padding:14px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dpg-state .dpg-dot{width:11px;height:11px;border-radius:50%;background:var(--dim);flex:none}
.dpg-state .dpg-name{font-size:17px;font-weight:600}
.dpg-state .dpg-desc{font-size:12.5px;color:var(--mute);margin-left:auto;text-align:right;max-width:46ch}
.dpg-root[data-state="surface"] .dpg-state{border-left-color:var(--cy)}
.dpg-root[data-state="lost"] .dpg-state{border-left-color:var(--amb);background:rgba(255,179,64,.06)}
.dpg-root[data-state="pinging"] .dpg-state{border-left-color:var(--red);background:rgba(255,59,48,.08)}
.dpg-root[data-state="contact"] .dpg-state{border-left-color:var(--blu);background:rgba(60,157,221,.08)}
.dpg-root[data-state="close"] .dpg-state{border-left-color:var(--cy);background:rgba(0,229,199,.1)}
@media (prefers-reduced-motion:no-preference){
  .dpg-root[data-state="pinging"] .dpg-dot,
  .dpg-root[data-state="contact"] .dpg-dot,
  .dpg-root[data-state="close"] .dpg-dot{animation:dpg-pulse var(--dpg-rate,1.4s) ease-out infinite}
}
@keyframes dpg-pulse{0%{transform:scale(1);opacity:1}45%{transform:scale(2);opacity:.25}100%{transform:scale(1);opacity:1}}
.dpg-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:12px;margin-top:12px}
@media(max-width:800px){.dpg-grid{grid-template-columns:1fr}}
.dpg-card{background:var(--panel);border:1px solid var(--line);padding:16px}
.dpg-cap{font:11px var(--mono);letter-spacing:.12em;color:var(--mute);margin:0 0 12px}
.dpg-scope{position:relative;aspect-ratio:1;max-width:260px;margin:0 auto}
.dpg-scope canvas{width:100%;height:100%;display:block}
.dpg-scopeval{position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;pointer-events:none}
.dpg-scopeval b{font:500 38px var(--mono);color:var(--cy);line-height:1;font-variant-numeric:tabular-nums}
.dpg-scopeval span{font:11px var(--mono);color:var(--mute);letter-spacing:.1em;margin-top:5px}
.dpg-root[data-state="surface"] .dpg-scopeval b,
.dpg-root[data-state="lost"] .dpg-scopeval b{color:var(--dim)}
.dpg-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  padding:9px 0;border-bottom:1px solid rgba(27,48,56,.6)}
.dpg-row:last-child{border-bottom:none}
.dpg-row .dpg-k{font:11.5px var(--mono);color:var(--mute);letter-spacing:.05em}
.dpg-v{font:500 14px var(--mono);font-variant-numeric:tabular-nums;text-align:right}
.dpg-v.dpg-ok{color:var(--cy)} .dpg-v.dpg-warn{color:var(--amb)}
.dpg-v.dpg-bad{color:var(--red)} .dpg-v.dpg-off{color:var(--dim)}
.dpg-v a{color:var(--cy);text-decoration:none;border-bottom:1px solid rgba(0,229,199,.35)}
.dpg-meter{height:34px;background:#071216;border:1px solid var(--line);
  position:relative;overflow:hidden;margin-top:4px}
.dpg-fill{height:100%;width:0;transition:width .25s,background .25s}
.dpg-ticks{position:absolute;inset:0;display:flex}
.dpg-ticks i{flex:1;border-right:1px solid rgba(5,10,14,.55)}
.dpg-ticks i:last-child{border-right:none}
.dpg-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.dpg-root button{font:500 12px system-ui,sans-serif;cursor:pointer;padding:8px 13px;
  background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:3px}
.dpg-root button:hover:not(:disabled){border-color:var(--cy);background:#133038}
.dpg-root button:focus-visible{outline:2px solid var(--cy);outline-offset:2px}
.dpg-root button.dpg-go{background:var(--cy);color:#042a26;border-color:var(--cy);font-weight:600}
.dpg-root button.dpg-arm{background:var(--red);color:#2a0604;border-color:var(--red);font-weight:600}
.dpg-note{font-size:12px;color:var(--mute);margin-top:12px;line-height:1.55;max-width:70ch}
`;
