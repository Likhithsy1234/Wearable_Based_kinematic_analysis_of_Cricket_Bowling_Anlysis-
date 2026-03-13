// CricketBowlerDashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "../components/Dashboard.css";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, onValue, set } from "firebase/database";

/* ---------- jsPDF loader (supports npm or CDN) ---------- */
async function getJsPDF() {
  try {
    const mod = await import("jspdf");
    return mod.jsPDF || mod.default;
  } catch {
    return window.jspdf?.jsPDF;
  }
}

/* ---------- Firebase (unchanged) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAhLCi6JBT5ELkAFxTplKBBDdRdpATzQxI",
  authDomain: "smart-medicine-vending-machine.firebaseapp.com",
  databaseURL:
    "https://smart-medicine-vending-machine-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-medicine-vending-machine",
  storageBucket: "smart-medicine-vending-machine.firebasestorage.app",
  messagingSenderId: "705021997077",
  appId: "1:705021997077:web:5af9ec0b267e597e1d5e1c",
  measurementId: "G-PH0XLJSYVS",
};
if (!getApps().length) initializeApp(firebaseConfig);

/* ---------- DB paths & constants ---------- */
const BASE_PATH = "Cricket_Bowler";
const SENSORS_PATH = `${BASE_PATH}/1_Sensor_Data`;
const MODES = ["Fast", "Swing", "Off spin", "Leg spin", "Yorker", "Bouncer"];

const SAMPLE_MS = 1000;      // sampling cadence
const LIVE_WINDOW = 60;       // seconds on charts when idle
const SESSION_SECS = 10;      // capture window after selecting a mode (10 seconds)
const BACKEND_API = "http://localhost:5000/api"; // not used, left for future

/* ---------- Mode limits (Smart Feedback Engine) ---------- */
const LIMITS_A = { // Fast / Swing / Yorker / Bouncer
  wrist: [90, 220],
  elbow: [45, 180],
  spine: [180, 200],
};
const LIMITS_B = { // Off spin / Leg spin
  wrist: [180, 230],
  elbow: [90, 250],
  spine: [180, 230],
};
const GROUP_B = new Set(["Off spin", "Leg spin"]);
function getLimitsForMode(mode) {
  return GROUP_B.has(mode) ? LIMITS_B : LIMITS_A;
}
function formatRange([lo, hi]) {
  return `${lo}°–${hi}°`;
}

/* ---------- RTDB hook ---------- */
function useRTDB(path, fallback = null) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const db = getDatabase();
    const r = ref(db, path);
    const off = onValue(
      r,
      (snap) => setValue(snap.exists() ? snap.val() : null),
      (err) => console.error("RTDB error @", path, err)
    );
    return () => off();
  }, [path]);
  return value;
}

/* ---------- helpers ---------- */
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
function parseBP(v) {
  if (v == null) return { sys: null, dia: null };
  const m = String(v).match(/(-?\d+\.?\d*)\s*\/\s*(-?\d+\.?\d*)/);
  return m ? { sys: num(m[1]), dia: num(m[2]) } : { sys: num(v), dia: null };
}
function statsFromPts(pts) {
  const vals = (pts || []).map(p => p?.v).filter(v => v != null && Number.isFinite(v));
  if (!vals.length) return { avg: null, min: null, max: null, std: null };
  const n = vals.length;
  const avg = vals.reduce((a,b)=>a+b,0)/n;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const std = Math.sqrt(vals.reduce((s,v)=>s+(v-avg)*(v-avg),0)/n);
  return { avg, min, max, std };
}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

/* ---------- simple multi-series canvas line chart ---------- */
function drawChart(canvas, series, tNow, windowSecs) {
  if (!canvas) return;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const tMin = tNow - windowSecs * 1000;
  const smooth = (arr, k=3) => {
    if (!arr || arr.length === 0) return arr || [];
    if (k <= 1) return arr;
    const out = [];
    for (let i=0; i<arr.length; i++) {
      const a = Math.max(0, i - Math.floor(k/2));
      const b = Math.min(arr.length, a + k);
      const slice = arr.slice(a, b);
      const sum = slice.reduce((s,p)=> s + (p.v ?? 0), 0);
      const cnt = slice.reduce((s,p)=> s + (p.v != null ? 1 : 0), 0) || 1;
      out.push({ t: arr[i].t, v: sum / cnt });
    }
    return out;
  };

  const inWin = series.map(s => {
    const pts = (s.pts || []).filter(p => p.t >= tMin && p.t <= tNow);
    // light smoothing for nicer waves, keep k small to reduce lag
    return { label: s.label, color: s.color, pts: smooth(pts, 3) };
  });

  // Determine dynamic range with adaptive zoom to make small waves visible
  let vMin = Infinity, vMax = -Infinity;
  const allVals = [];
  inWin.forEach(s => s.pts.forEach(p => {
    if (p.v != null && Number.isFinite(p.v)) {
      vMin = Math.min(vMin, p.v);
      vMax = Math.max(vMax, p.v);
      allVals.push(p.v);
    }
  }));
  if (!isFinite(vMin) || !isFinite(vMax)) { vMin = 0; vMax = 1; }
  let rawRange = vMax - vMin;
  if (rawRange === 0) { vMin -= 1; vMax += 1; rawRange = 2; }

  // If the raw range is too small, expand around mean to ensure visible waves
  const minVisualRange = 10; // degrees/units; ensures ~sensible amplitude
  if (rawRange < minVisualRange && allVals.length) {
    const avg = allVals.reduce((a,b)=>a+b,0)/allVals.length;
    let std = Math.sqrt(allVals.reduce((s,v)=>s+(v-avg)*(v-avg),0)/allVals.length);
    const span = Math.max(minVisualRange, (std || 0) * 4); // ±2σ at least
    vMin = avg - span/2;
    vMax = avg + span/2;
  }

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 10 + (H - 20) * (i / 4);
    ctx.beginPath(); ctx.moveTo(46, y); ctx.lineTo(W - 10, y); ctx.stroke();
  }

  // min/max labels
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.fillText(vMax.toFixed(1), 8, 16);
  ctx.fillText(vMin.toFixed(1), 8, H - 6);

  // plot
  inWin.forEach(s => {
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = s.color;
    let first = true;
    s.pts.forEach(p => {
      if (p.v == null) return;
      const x = 46 + (W - 56) * ((p.t - tMin) / (tNow - tMin || 1));
      const y = 10 + (H - 20) * (1 - (p.v - vMin) / (vMax - vMin));
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // legend capsule
  let lx = 54;
  inWin.forEach(s => {
    const label = s.label;
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(lx - 6, 6, textW + 22, 16);
    ctx.fillStyle = s.color; ctx.fillRect(lx, 9, 10, 10);
    ctx.fillStyle = "#fff"; ctx.fillText(label, lx + 14, 18);
    lx += textW + 32;
  });
}

/* =================== COMPONENT =================== */
export default function CricketBowlerDashboard() {
  /* live values */
  const nodeState = useRTDB(`${BASE_PATH}/_node`, "online");
  const sensors   = useRTDB(SENSORS_PATH, {});
  const bowlingType = useRTDB(`${BASE_PATH}/_bowling_type`, "");
  const ballStats = useRTDB(`${BASE_PATH}/ball_stats`, {}); // {count,last_speed_kmph}
  const sessionsObj = useRTDB(`${BASE_PATH}/sessions`, {}); // for history

  /* extract (renamed) */
  const temp  = sensors?.["1_Temp"];
  const hum   = sensors?.["2_Hum"];
  const wrist = sensors?.["3_MPU_1"] || {}; // Wrist
  const elbow = sensors?.["4_MPU_2"] || {}; // Elbow
  const spine = sensors?.["5_MPU_3"] || {}; // Spine
  const hr    = sensors?.["6_HR"];
  const spo2  = sensors?.["7_SPO2"];
  const bp    = sensors?.["8_BP"];
  const { sys, dia } = parseBP(bp);

  /* status pill */
  const { statusClass, statusText } = useMemo(() => {
    const s = String(nodeState || "").toLowerCase();
    if (s.includes("offline")) return { statusClass: "bad",  statusText: "OFFLINE" };
    if (s.includes("idle"))    return { statusClass: "warn", statusText: "IDLE" };
    return { statusClass: "ok", statusText: "ONLINE" };
  }, [nodeState]);

  /* live history buffers */
  const hist = useRef({
    wA: [], wAng: [],
    eA: [], eAng: [],
    sA: [], sAng: [],
    HR: [], SPO2: [], SYS: [], DIA: []
  });

  /* session state */
  const [session, setSession] = useState({
    active: false,
    id: null,
    mode: null,
    start: 0,
    secs: 0,
    data: { wA:[], wAng:[], eA:[], eAng:[], sA:[], sAng:[], HR:[], SPO2:[], SYS:[], DIA:[] }
  });
  const sessionRef = useRef(session);
  useEffect(()=>{ sessionRef.current = session; }, [session]);

  /* over tracking */
  const overNumRef = useRef(1);
  const overSpeedsRef = useRef([]);
  const sessionOversRef = useRef([]); // [{over, avg, top, balls:[...]}]

  /* per-ball tracking */
  const perBallDataRef = useRef([]); // [{ballNum, kmph, mode, timestamp, snapshot: {wA, wAng, eA, eAng, sA, sAng, HR, SPO2, SYS, DIA}}]

  /* smart feedback state/refs */
  const [liveIssues, setLiveIssues] = useState([]); // strings for UI
  const alertCooldownRef = useRef(0);
  const alertCountsRef = useRef({ wrist: 0, elbow: 0, spine: 0 }); // for session PDF
  const overAlertCountsRef = useRef({ wrist: 0, elbow: 0, spine: 0 }); // for over PDF
  const sessionAlertsRef = useRef([]); // [{t, issues: [...] }]

  /* ---- Toast system (no external libs) ---- */
  const [toasts, setToasts] = useState([]);
  const pushToast = (title, lines, type = "danger") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((t) => [...t, { id, title, lines, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };
  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toastColors = { danger: "#e74c3c", warn: "#f39c12", ok: "#2ecc71" };

  /* ball stats */
  const [ballCount, setBallCount] = useState(0);
  const [lastSpeedKmph, setLastSpeedKmph] = useState(null);
  const [distM, setDistM] = useState(2.0);
  const prevBallCountRef = useRef(0);
  const prevSpeedRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCountdown, setRecordingCountdown] = useState(0);
  const recordingTimerRef = useRef(null);

  useEffect(() => {
    console.log('ballStats updated from Firebase:', ballStats);
    
    const c = Number(ballStats?.count);
    const ls = Number(ballStats?.last_speed_kmph);
    
    console.log(`Processing: count=${c}, speed=${ls}, prev count=${prevBallCountRef.current}, prev speed=${prevSpeedRef.current}`);
    
    // Always update display values when they're valid
    if (Number.isFinite(c)) {
      setBallCount(c);
    }
    if (Number.isFinite(ls)) {
      setLastSpeedKmph(ls);
    }
    
    // Capture data ONLY when count increases AND we haven't captured this ball yet
    const alreadyCaptured = perBallDataRef.current.some(b => b.ballNum === c);
    
    if (Number.isFinite(c) && c > prevBallCountRef.current && Number.isFinite(ls) && ls > 0 && !alreadyCaptured) {
      console.log(`New ball detected! Count increased from ${prevBallCountRef.current} to ${c}, Speed: ${ls}`);
      
      // Update ref immediately to prevent duplicate captures
      prevBallCountRef.current = c;
      prevSpeedRef.current = ls;
      
      // Longer delay to ensure Firebase data is fully synchronized
      setTimeout(() => {
        const finalSpeed = Number(ballStats?.last_speed_kmph);
        if (!Number.isFinite(finalSpeed) || finalSpeed <= 0) {
          console.warn(`Invalid speed ${finalSpeed} after delay, skipping ball #${c}`);
          return;
        }
        
        // Double-check we haven't already captured this ball
        const stillNotCaptured = !perBallDataRef.current.some(b => b.ballNum === c);
        if (!stillNotCaptured) {
          console.warn(`Ball #${c} already captured, skipping duplicate`);
          return;
        }
        
        const ts = Date.now();
        const mode = sessionRef.current?.mode || bowlingType || "-";
        
        // Capture comprehensive data from BOTH Firebase and live sensors
        const ballSnapshot = {
          ballNum: c,
          kmph: Number(finalSpeed.toFixed(1)),
          mode,
          timestamp: ts,
          // Data from Firebase
          firebaseData: {
            count: ballStats?.count,
            speed: ballStats?.last_speed_kmph
          },
          // Data from live sensors (last 10 samples)
          snapshot: {
            wA: hist.current.wA.slice(-10),
            wAng: hist.current.wAng.slice(-10),
            eA: hist.current.eA.slice(-10),
            eAng: hist.current.eAng.slice(-10),
            sA: hist.current.sA.slice(-10),
            sAng: hist.current.sAng.slice(-10),
            HR: hist.current.HR.slice(-10),
            SPO2: hist.current.SPO2.slice(-10),
            SYS: hist.current.SYS.slice(-10),
            DIA: hist.current.DIA.slice(-10)
          },
          // Current live sensor readings
          liveReadings: {
            temp: sensors?.["1_Temp"],
            humidity: sensors?.["2_Hum"],
            wrist: {
              accel: num(wrist?.A),
              angle: num(wrist?.Angle)
            },
            elbow: {
              accel: num(elbow?.A),
              angle: num(elbow?.Angle)
            },
            spine: {
              accel: num(spine?.A),
              angle: num(spine?.Angle)
            },
            hr: num(hr),
            spo2: num(spo2),
            bp: { sys: sys, dia: dia }
          }
        };
        
        perBallDataRef.current.push(ballSnapshot);
        console.log(`✓ Captured ball #${c} - Speed: ${finalSpeed} km/h - Mode: ${mode}`, ballSnapshot);
        
        // Track for over reports
        addOverAndMaybeReport(finalSpeed);
      }, 300); // 300ms delay to ensure Firebase is fully synchronized
    }
  }, [ballStats]);

  const addOverAndMaybeReport = async (kmh) => {
    // Only add valid speeds (greater than 0)
    if (kmh > 0) {
      overSpeedsRef.current.push(kmh);
      console.log(`Ball speed ${kmh} km/h added to over. Current over has ${overSpeedsRef.current.length} balls`);
    } else {
      console.warn(`Invalid speed ${kmh} km/h not added to over tracking`);
    }
    
    if (overSpeedsRef.current.length >= 6) {
      const balls = overSpeedsRef.current.slice(0,6);
      overSpeedsRef.current = [];
      const over = overNumRef.current++;
      
      // Filter valid speeds and calculate
      const validBalls = balls.filter(b => b > 0);
      const avg = validBalls.length > 0 ? validBalls.reduce((a,b)=>a+b,0)/validBalls.length : 0;
      const top = validBalls.length > 0 ? Math.max(...validBalls) : 0;
      
      const overData = { over, avg, top, balls };
      sessionOversRef.current.push(overData);
      console.log(`✓ Over ${over} completed - Avg: ${avg.toFixed(1)}, Top: ${top.toFixed(1)}:`, overData);

      // copy & reset over alert counters for the PDF
      const overAlerts = { ...overAlertCountsRef.current };
      overAlertCountsRef.current = { wrist: 0, elbow: 0, spine: 0 };

      // Auto-download removed - user will click button to download
      console.log('Over report ready. Click "Download Final Report" to generate PDF.');
    }
  };

  const updateBallStats = (newCount, kmh) => {
    // This function is kept for manual ball updates if needed
    setBallCount(newCount);
    setLastSpeedKmph(kmh);

    const db = getDatabase();
    set(ref(db, `${BASE_PATH}/ball_stats/count`), newCount);
    set(ref(db, `${BASE_PATH}/ball_stats/last_speed_kmph`), Number(kmh.toFixed(1)));

    const sid = sessionRef.current?.id;
    const mode = sessionRef.current?.mode || bowlingType || "-";
    const ts = Date.now();

    if (sid) {
      set(ref(db, `${BASE_PATH}/sessions/${sid}/balls/${ts}`), {
        kmph: Number(kmh.toFixed(1)),
        mode
      });
    }
  };

  /* smart feedback evaluation */
  function evalIssues(mode, w, e, s) {
    const L = getLimitsForMode(mode || "-");
    const out = [];
    if (w != null && (w < L.wrist[0] || w > L.wrist[1])) out.push(`Wrist angle ${w.toFixed(1)}° is outside ${formatRange(L.wrist)}`);
    if (e != null && (e < L.elbow[0] || e > L.elbow[1])) out.push(`Elbow angle ${e.toFixed(1)}° is outside ${formatRange(L.elbow)}`);
    if (s != null && (s < L.spine[0] || s > L.spine[1])) out.push(`Spine angle ${s.toFixed(1)}° is outside ${formatRange(L.spine)}`);
    return { issues: out, limits: L };
  }

  /* sampling & per-second vitals logging + Smart Feedback checks */
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      const push = (arr, v) => { arr.push({ t, v }); if (arr.length > LIVE_WINDOW + 600) arr.shift(); };

      const wA = num(wrist.A),  wAng = num(wrist.Angle);
      const eA = num(elbow.A),  eAng = num(elbow.Angle);
      const sA = num(spine.A),  sAng = num(spine.Angle);

      push(hist.current.wA,   wA);
      push(hist.current.wAng, wAng);
      push(hist.current.eA,   eA);
      push(hist.current.eAng, eAng);
      push(hist.current.sA,   sA);
      push(hist.current.sAng, sAng);
      push(hist.current.HR,   num(hr));
      push(hist.current.SPO2, num(spo2));
      push(hist.current.SYS,  num(sys));
      push(hist.current.DIA,  num(dia));

      // ----- Smart Feedback: live check & toast
      const modeNow = sessionRef.current.mode || bowlingType || "-";
      const { issues, limits } = evalIssues(modeNow, wAng, eAng, sAng);
      setLiveIssues(issues);

      if (issues.length) {
        // count per joint for session + over
        issues.forEach(msg => {
          if (msg.startsWith("Wrist")) { alertCountsRef.current.wrist++; overAlertCountsRef.current.wrist++; }
          else if (msg.startsWith("Elbow")) { alertCountsRef.current.elbow++; overAlertCountsRef.current.elbow++; }
          else if (msg.startsWith("Spine")) { alertCountsRef.current.spine++; overAlertCountsRef.current.spine++; }
        });
        // store for session PDF
        sessionAlertsRef.current.push({ t, issues });

        // throttled toast (every 5s max)
        const now = performance.now();
        if (now - alertCooldownRef.current > 5000) {
          alertCooldownRef.current = now;
          const lines = [
            ...issues,
            "",
            `Recommended ranges for ${modeNow}:`,
            `Wrist ${formatRange(limits.wrist)}, Elbow ${formatRange(limits.elbow)}, Spine ${formatRange(limits.spine)}.`
          ];
          pushToast("DANGER", lines, "danger");
        }
      }

      // ----- session logging
      if (sessionRef.current.active) {
        const s = sessionRef.current;
        const d = s.data;
        d.wA.push({ t, v: wA });   d.wAng.push({ t, v: wAng });
        d.eA.push({ t, v: eA });   d.eAng.push({ t, v: eAng });
        d.sA.push({ t, v: sA });   d.sAng.push({ t, v: sAng });
        d.HR.push({ t, v: num(hr) });        d.SPO2.push({ t, v: num(spo2) });
        d.SYS.push({ t, v: num(sys) });      d.DIA.push({ t, v: num(dia) });

        // store vitals every second
        const db = getDatabase();
        set(ref(db, `${BASE_PATH}/sessions/${s.id}/vitals/${t}`), {
          HR: num(hr), SPO2: num(spo2), SYS: num(sys), DIA: num(dia)
        });

        const elapsed = Math.floor((t - s.start) / 1000);
        setSession(prev => ({ ...prev, secs: Math.min(elapsed, SESSION_SECS) }));
        if (elapsed >= SESSION_SECS) setSession(prev => ({ ...prev, active: false }));
      }
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [wrist, elbow, spine, hr, spo2, sys, dia, bowlingType]);

  /* start 10s recording when selecting a mode, then increment ball count */
  const setBowlingType = async (mode) => {
    if (isRecording) {
      console.log('Already recording, please wait...');
      return;
    }

    const db = getDatabase();
    await set(ref(db, `${BASE_PATH}/_bowling_type`), mode);

    const newCount = ballCount + 1;
    console.log(`🎳 Starting 10-second recording for ${mode} (Ball #${newCount})...`);
    
    // Start recording
    setIsRecording(true);
    setRecordingCountdown(10);
    
    // Start or continue session
    let sessionId = sessionRef.current?.id;
    if (!sessionId || !sessionRef.current.active) {
      sessionId = `S${Date.now()}`;
      const start = Date.now();
      
      // Only reset counters if starting a new session
      if (ballCount === 0) {
        overNumRef.current = 1;
        overSpeedsRef.current = [];
        sessionOversRef.current = [];
        alertCountsRef.current = { wrist: 0, elbow: 0, spine: 0 };
        overAlertCountsRef.current = { wrist: 0, elbow: 0, spine: 0 };
        sessionAlertsRef.current = [];
      }

      setSession({
        active: true, id: sessionId, mode, start, secs: 0,
        data: { wA:[], wAng:[], eA:[], eAng:[], sA:[], sAng:[], HR:[], SPO2:[], SYS:[], DIA:[] }
      });
      await set(ref(db, `${BASE_PATH}/sessions/${sessionId}/meta`), { mode, start });
    }

    // Countdown timer
    let countdown = 10;
    const countdownInterval = setInterval(() => {
      countdown--;
      setRecordingCountdown(countdown);
      
      if (countdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    // After 10 seconds, calculate speed and update
    recordingTimerRef.current = setTimeout(async () => {
      const simulatedSpeed = 60 + Math.random() * 30; // 60-90 km/h simulated speed
      
      console.log(`✓ Recording complete! Ball #${newCount} - Speed: ${simulatedSpeed.toFixed(1)} km/h`);
      
      // Update Firebase with new ball count and speed
      await set(ref(db, `${BASE_PATH}/ball_stats/count`), newCount);
      await set(ref(db, `${BASE_PATH}/ball_stats/last_speed_kmph`), Number(simulatedSpeed.toFixed(1)));

      // Store ball in session
      const ts = Date.now();
      await set(ref(db, `${BASE_PATH}/sessions/${sessionId}/balls/${ts}`), {
        kmph: Number(simulatedSpeed.toFixed(1)),
        mode
      });
      
      setIsRecording(false);
      setRecordingCountdown(0);
    }, 10000); // 10 seconds
  };

  /* chart refs & render loop */
  const wristCanvas = useRef(null);
  const elbowCanvas = useRef(null);
  const spineCanvas = useRef(null);
  const vCanvas  = useRef(null);
  
  // Individual vital/environmental canvases
  const tempCanvas = useRef(null);
  const humidityCanvas = useRef(null);
  const hrCanvas = useRef(null);
  const spo2Canvas = useRef(null);
  const bpCanvas = useRef(null);

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const now = Date.now();
      const win = sessionRef.current.active ? SESSION_SECS : LIVE_WINDOW;

      drawChart(wristCanvas.current, [
        { label: "Accel", color: "#2ecc71", pts: hist.current.wA   },
        { label: "Angle", color: "#8be9fd", pts: hist.current.wAng }
      ], now, win);

      drawChart(elbowCanvas.current, [
        { label: "Accel", color: "#2ecc71", pts: hist.current.eA   },
        { label: "Angle", color: "#8be9fd", pts: hist.current.eAng }
      ], now, win);

      drawChart(spineCanvas.current, [
        { label: "Accel", color: "#2ecc71", pts: hist.current.sA   },
        { label: "Angle", color: "#8be9fd", pts: hist.current.sAng }
      ], now, win);

      drawChart(vCanvas.current, [
        { label: "HR",   color: "#ff7675", pts: hist.current.HR  },
        { label: "SPO2", color: "#f1fa8c", pts: hist.current.SPO2 },
        { label: "SYS",  color: "#bd93f9", pts: hist.current.SYS },
        { label: "DIA",  color: "#ffb86c", pts: hist.current.DIA }
      ], now, win);

      // Individual vital charts
      drawChart(tempCanvas.current, [
        { label: "Temperature", color: "#ff6348", pts: hist.current.HR.map(p => ({t: p.t, v: num(temp)})) }
      ], now, win);

      drawChart(humidityCanvas.current, [
        { label: "Humidity", color: "#00d2d3", pts: hist.current.HR.map(p => ({t: p.t, v: num(hum)})) }
      ], now, win);

      drawChart(hrCanvas.current, [
        { label: "Heart Rate", color: "#ff7675", pts: hist.current.HR }
      ], now, win);

      drawChart(spo2Canvas.current, [
        { label: "SpO2", color: "#74b9ff", pts: hist.current.SPO2 }
      ], now, win);

      drawChart(bpCanvas.current, [
        { label: "Systolic", color: "#bd93f9", pts: hist.current.SYS },
        { label: "Diastolic", color: "#ffb86c", pts: hist.current.DIA }
      ], now, win);

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ===== Analytics, Suggestions, Reports ===== */

  function computeAnalytics(sessData) {
    const wAng = statsFromPts(sessData.wAng);
    const eAng = statsFromPts(sessData.eAng);
    const sAng = statsFromPts(sessData.sAng);

    const norm = (std) => std == null ? 1 : clamp(std / 45, 0, 1);
    const angleInstability = (norm(wAng.std) + norm(eAng.std) + norm(sAng.std)) / 3;
    const consistencyScore = Math.round(100 * (1 - angleInstability));

    // crude stamina proxy from HR drift if available
    const hrVals = (sessData.HR || []).map(p=>p.v).filter(v=>v!=null);
    let staminaScore = 100;
    if (hrVals.length >= 6) {
      const third = Math.floor(hrVals.length/3);
      const startAvg = hrVals.slice(0, third).reduce((a,b)=>a+b,0)/third;
      const endAvg = hrVals.slice(-third).reduce((a,b)=>a+b,0)/third;
      const rise = startAvg ? (endAvg - startAvg)/startAvg : 0;
      staminaScore = Math.round(100 - clamp((rise - 0.1) * 400, 0, 100));
    }

    return {
      scores: {
        consistency: consistencyScore,
        stamina: staminaScore,
        overall: Math.round((consistencyScore*0.65)+(staminaScore*0.35))
      },
      stats: { wAng, eAng, sAng }
    };
  }

  const historicalSessions = useMemo(() => {
    const arr = [];
    if (sessionsObj && typeof sessionsObj === "object") {
      for (const [sid, s] of Object.entries(sessionsObj)) {
        const start = s?.meta?.start || 0;
        const balls = s?.balls ? Object.values(s.balls).map(b => Number(b?.kmph)).filter(v => Number.isFinite(v)) : [];
        if (balls.length) {
          const avg = balls.reduce((a,b)=>a+b,0)/balls.length;
          const top = Math.max(...balls);
          arr.push({ id: sid, start, avg, top });
        }
      }
    }
    return arr.sort((a,b)=>a.start-b.start).slice(-8);
  }, [sessionsObj]);

  function makeTinyBarChartDataURL(items, w=180, h=60, pad=8) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#111"; ctx.fillRect(0,0,w,h);
    if (!items || !items.length) {
      ctx.fillStyle = "#fff"; ctx.font="12px ui-monospace, Menlo";
      ctx.fillText("No history", pad, h/2);
      return c.toDataURL("image/png");
    }
    const max = Math.max(...items.map(x=>x.avg));
    const barW = (w - pad*2) / items.length - 4;
    items.forEach((x,i) => {
      const bh = max ? (x.avg/max)*(h - pad*2) : 0;
      const x0 = pad + i*(barW+4);
      const y0 = h - pad - bh;
      ctx.fillStyle = "#8be9fd";
      ctx.fillRect(x0, y0, barW, bh);
    });
    ctx.fillStyle="#fff"; ctx.font="10px ui-monospace, Menlo";
    ctx.fillText("Avg speed history", pad, 12);
    return c.toDataURL("image/png");
  }

  async function addCanvasBlock(pdf, title, canvas, x, y, w, h) {
    if (!canvas) return y;
    pdf.setFont("Helvetica","bold").text(title, x, y); y += 4;
    const img = canvas.toDataURL("image/png");
    pdf.addImage(img, "PNG", x, y, w, h);
    return y + h + 8;
  }

  function addKV(pdf, x, y, rows) {
    pdf.setFont("Helvetica","normal").setFontSize(11);
    rows.forEach(([k,v]) => { pdf.text(`${k}: ${v}`, x, y); y += 5; });
    return y + 2;
  }

  function addOverTable(pdf, x, y, overs) {
    const startY = y;
    pdf.setFont("Helvetica","bold").setFontSize(14);
    pdf.text("Performance per Over", x, y); y += 8;
    
    if (!overs || overs.length === 0) {
      pdf.setFont("Helvetica","normal").setFontSize(11);
      pdf.text("No overs completed yet", x, y); y += 5;
    } else {
      // Table header
      pdf.setFont("Helvetica","bold").setFontSize(11);
      pdf.text("Over", x, y);
      pdf.text("Avg (km/h)", x + 50, y);
      pdf.text("Top (km/h)", x + 120, y);
      y += 4;
      pdf.setDrawColor(150); 
      pdf.line(x, y, x+190, y); 
      y += 5;
      
      // Table rows
      pdf.setFont("Helvetica","normal").setFontSize(11);
      overs.forEach(o => {
        const overLabel = o.incomplete ? `${o.over}*` : String(o.over);
        
        // Over number
        pdf.text(overLabel, x + 5, y);
        
        // Average
        pdf.text(o.avg.toFixed(1), x + 60, y);
        
        // Top speed
        pdf.text(o.top.toFixed(1), x + 130, y);
        
        y += 5;
      });
      
      // Add detailed ball-by-ball breakdown with bowling types
      y += 5;
      pdf.setFont("Helvetica","bold").setFontSize(12);
      pdf.text("Ball-by-Ball Breakdown", x, y); y += 6;
      
      pdf.setFont("Helvetica","bold").setFontSize(9);
      pdf.text("Ball #", x, y);
      pdf.text("Speed (km/h)", x + 25, y);
      pdf.text("Bowling Type", x + 75, y);
      y += 4;
      pdf.setDrawColor(150);
      pdf.line(x, y, x+190, y);
      y += 4;
      
      pdf.setFont("Helvetica","normal").setFontSize(9);
      
      // Get ball data from perBallDataRef
      const allBalls = perBallDataRef.current.slice().sort((a, b) => a.ballNum - b.ballNum);
      if (allBalls.length > 0) {
        allBalls.forEach(ball => {
          pdf.text(String(ball.ballNum), x + 5, y);
          pdf.text(ball.kmph.toFixed(1), x + 35, y);
          pdf.text(ball.mode || "-", x + 75, y);
          y += 4;
        });
      } else {
        pdf.text("No detailed ball data available", x, y);
        y += 4;
      }
      
      y += 3;
      
      // Note for incomplete overs
      if (overs.some(o => o.incomplete)) {
        pdf.setFontSize(8);
        pdf.setTextColor(100);
        pdf.text("* Incomplete over (less than 6 balls)", x, y);
        pdf.setTextColor(0);
        pdf.setFontSize(11);
        y += 4;
      }
    }
    return Math.max(y, startY+10);
  }

  // Coaching suggestions per bowling type
  function getSuggestionsForMode(mode) {
    // Group A: Fast / Swing / Yorker / Bouncer
    const groupA = [
      "A consistent run-up length helps control your bowling action and generate momentum.",
      "Keep your wrist straight and firm at the moment of release to improve accuracy and control.",
      "Land your front foot pointing towards the batsman, drive your arms upwards, and complete a full rotation of your bowling arm to maximize speed and momentum."
    ];
    // Group B: Off spin / Leg spin
    const groupB = [
      "Hold the ball with your index and middle fingers across the seam and the thumb for support. The index finger generates the spin by rolling over the ball.",
      "Use your index and middle fingers on the seam, with your ring finger bent. The wrist and fingers flick forward during release to impart maximum spin.",
      "A high, consistent release point will maximize bounce and drift, making the ball harder for the batsman to judge."
    ];
    return GROUP_B.has(mode) ? groupB : groupA;
  }

  function addSuggestionsSection(pdf, x, y, mode) {
    const lines = getSuggestionsForMode(mode);
    pdf.setFont("Helvetica","bold").text("Coaching Suggestions", x, y); y += 6;
    pdf.setFont("Helvetica","normal");
    const contentWidth = 180; // keep within our layout width
    lines.forEach((ln) => {
      const wrapped = pdf.splitTextToSize(`• ${ln}`, contentWidth);
      wrapped.forEach((wline) => { pdf.text(wline, x, y); y += 5; });
    });
    return y + 4;
  }

  function addSafetySection(pdf, x, y, mode, limits, counts) {
    pdf.setFont("Helvetica","bold").text("Smart Feedback & Safety", x, y); y += 6;
    pdf.setFont("Helvetica","normal");
    y = addKV(pdf, x, y, [
      ["Mode", mode || "-"],
      ["Wrist (recommended)", formatRange(limits.wrist)],
      ["Elbow (recommended)", formatRange(limits.elbow)],
      ["Spine (recommended)", formatRange(limits.spine)],
      ["Alerts (this period)", `Wrist ${counts.wrist} · Elbow ${counts.elbow} · Spine ${counts.spine}`],
    ]);
    pdf.setFont("Helvetica","normal");
    pdf.text(
      "Note: Repeated out-of-range angles can increase stress on wrist/elbow tendons and the lower back. Maintain technique within recommended ranges.",
      x, y
    );
    return y + 10;
  }

  async function downloadPerBallReport() {
    const currentBall = ballCount;
    if (currentBall === 0) {
      alert("No balls bowled yet!");
      return;
    }

    console.log('Per-ball data available:', perBallDataRef.current);
    let ballData = perBallDataRef.current.find(b => b.ballNum === currentBall);
    
    // FALLBACK: If no data found, create it from current state
    if (!ballData) {
      console.warn(`No stored data for ball #${currentBall}, creating from current state...`);
      ballData = {
        ballNum: currentBall,
        kmph: lastSpeedKmph || 0,
        mode: bowlingType || "-",
        timestamp: Date.now(),
        firebaseData: {
          count: currentBall,
          speed: lastSpeedKmph
        },
        snapshot: {
          wA: hist.current.wA.slice(-10),
          wAng: hist.current.wAng.slice(-10),
          eA: hist.current.eA.slice(-10),
          eAng: hist.current.eAng.slice(-10),
          sA: hist.current.sA.slice(-10),
          sAng: hist.current.sAng.slice(-10),
          HR: hist.current.HR.slice(-10),
          SPO2: hist.current.SPO2.slice(-10),
          SYS: hist.current.SYS.slice(-10),
          DIA: hist.current.DIA.slice(-10)
        },
        liveReadings: {
          temp: sensors?.["1_Temp"],
          humidity: sensors?.["2_Hum"],
          wrist: {
            accel: num(wrist?.A),
            angle: num(wrist?.Angle)
          },
          elbow: {
            accel: num(elbow?.A),
            angle: num(elbow?.Angle)
          },
          spine: {
            accel: num(spine?.A),
            angle: num(spine?.Angle)
          },
          hr: num(hr),
          spo2: num(spo2),
          bp: { sys: sys, dia: dia }
        }
      };
      console.log('Created fallback ball data:', ballData);
    }

    const JSPDF = await getJsPDF();
    if (!JSPDF) { alert("jsPDF not available. Install 'jspdf' or add the CDN."); return; }

    const pdf = new JSPDF("p", "mm", "a4");
    const margin = 10;
    let y = 16;

    const modeNow = ballData.mode || "-";
    const limits = getLimitsForMode(modeNow);

    pdf.setFont("Helvetica", "bold").setFontSize(16);
    pdf.text(`Ball #${currentBall} Report – Cricket Bowler`, margin, y); y += 8;
    pdf.setFontSize(11).setFont("Helvetica", "normal");
    
    const timestamp = new Date(ballData.timestamp).toLocaleTimeString();
    y = addKV(pdf, margin, y, [
      ["Ball Number", String(currentBall)],
      ["Mode", modeNow],
      ["Speed", `${ballData.kmph.toFixed(1)} km/h`],
      ["Time", timestamp]
    ]);

    // Calculate stats from snapshot
    const snap = ballData.snapshot;
    const wAngStats = statsFromPts(snap.wAng);
    const eAngStats = statsFromPts(snap.eAng);
    const sAngStats = statsFromPts(snap.sAng);
    const hrStats = statsFromPts(snap.HR);
    const spo2Stats = statsFromPts(snap.SPO2);

    pdf.setFont("Helvetica","bold").text("Ball Performance Metrics", margin, y); y += 6;
    pdf.setFont("Helvetica","normal");
    y = addKV(pdf, margin, y, [
      ["Wrist Angle", `${wAngStats.avg?.toFixed?.(1) ?? "-"}° (std: ${wAngStats.std?.toFixed?.(1) ?? "-"}°)`],
      ["Elbow Angle", `${eAngStats.avg?.toFixed?.(1) ?? "-"}° (std: ${eAngStats.std?.toFixed?.(1) ?? "-"}°)`],
      ["Spine Angle", `${sAngStats.avg?.toFixed?.(1) ?? "-"}° (std: ${sAngStats.std?.toFixed?.(1) ?? "-"}°)`],
      ["Heart Rate", hrStats.avg ? `${hrStats.avg.toFixed(0)} bpm` : "-"],
      ["SpO2", spo2Stats.avg ? `${spo2Stats.avg.toFixed(1)}%` : "-"]
    ]);

    // Check if angles were in range
    pdf.setFont("Helvetica","bold").text("Angle Safety Check", margin, y); y += 6;
    pdf.setFont("Helvetica","normal");
    const wAngAvg = wAngStats.avg;
    const eAngAvg = eAngStats.avg;
    const sAngAvg = sAngStats.avg;
    const wOk = wAngAvg && wAngAvg >= limits.wrist[0] && wAngAvg <= limits.wrist[1];
    const eOk = eAngAvg && eAngAvg >= limits.elbow[0] && eAngAvg <= limits.elbow[1];
    const sOk = sAngAvg && sAngAvg >= limits.spine[0] && sAngAvg <= limits.spine[1];
    
    y = addKV(pdf, margin, y, [
      ["Wrist", `${wOk ? "✓" : "✗"} ${wOk ? "In range" : "Out of range"} (${formatRange(limits.wrist)})`],
      ["Elbow", `${eOk ? "✓" : "✗"} ${eOk ? "In range" : "Out of range"} (${formatRange(limits.elbow)})`],
      ["Spine", `${sOk ? "✓" : "✗"} ${sOk ? "In range" : "Out of range"} (${formatRange(limits.spine)})`]
    ]);

    // Mode-specific coaching suggestions
    y = addSuggestionsSection(pdf, margin, y, modeNow);

    // Create temporary canvases with ball-specific data for charts
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 800;
    tempCanvas.height = 200;

    // Draw wrist chart
    drawChart(tempCanvas, [
      { label: "Accel", color: "#2ecc71", pts: snap.wA },
      { label: "Angle", color: "#8be9fd", pts: snap.wAng }
    ], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Wrist (Accel, Angle) - Ball #" + currentBall, tempCanvas, margin, y, 180, 60);

    // Page 2: Elbow chart
    pdf.addPage();
    y = 16;
    drawChart(tempCanvas, [
      { label: "Accel", color: "#2ecc71", pts: snap.eA },
      { label: "Angle", color: "#8be9fd", pts: snap.eAng }
    ], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Elbow (Accel, Angle) - Ball #" + currentBall, tempCanvas, margin, y, 180, 60);

    // Page 3: Spine chart
    pdf.addPage();
    y = 16;
    drawChart(tempCanvas, [
      { label: "Accel", color: "#2ecc71", pts: snap.sA },
      { label: "Angle", color: "#8be9fd", pts: snap.sAng }
    ], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Spine (Accel, Angle) - Ball #" + currentBall, tempCanvas, margin, y, 180, 60);

    // Page 4: Vitals chart
    pdf.addPage();
    y = 16;
    drawChart(tempCanvas, [
      { label: "HR", color: "#ff7675", pts: snap.HR },
      { label: "SPO2", color: "#f1fa8c", pts: snap.SPO2 },
      { label: "SYS", color: "#bd93f9", pts: snap.SYS },
      { label: "DIA", color: "#ffb86c", pts: snap.DIA }
    ], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Vitals (HR, SPO2, SYS, DIA) - Ball #" + currentBall, tempCanvas, margin, y, 180, 60);

    // Add individual environmental and vital charts (2 per page)
    pdf.addPage();
    y = 16;

    pdf.setFont("Helvetica","bold").setFontSize(14);
    pdf.text("Environmental & Vital Metrics Details", margin, y); y += 10;

    // Page 1: Temperature and Humidity
    const tempVals = Array(10).fill({t: ballData.timestamp, v: ballData.liveReadings?.temp || 0});
    drawChart(tempCanvas, [{label: "Temperature (°C)", color: "#ff6348", pts: tempVals}], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Temperature", tempCanvas, margin, y, 180, 60);
    y += 5;

    const humVals = Array(10).fill({t: ballData.timestamp, v: ballData.liveReadings?.humidity || 0});
    drawChart(tempCanvas, [{label: "Humidity (%)", color: "#00d2d3", pts: humVals}], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Humidity", tempCanvas, margin, y, 180, 60);

    // Page 2: Heart Rate and SpO2
    pdf.addPage();
    y = 16;

    drawChart(tempCanvas, [{label: "Heart Rate (bpm)", color: "#ff7675", pts: snap.HR}], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Heart Rate", tempCanvas, margin, y, 180, 60);
    y += 5;

    drawChart(tempCanvas, [{label: "SpO2 (%)", color: "#74b9ff", pts: snap.SPO2}], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Blood Oxygen (SpO2)", tempCanvas, margin, y, 180, 60);

    // Page 3: Blood Pressure
    pdf.addPage();
    y = 16;

    drawChart(tempCanvas, [
      {label: "Systolic", color: "#bd93f9", pts: snap.SYS},
      {label: "Diastolic", color: "#ffb86c", pts: snap.DIA}
    ], ballData.timestamp, 10);
    y = await addCanvasBlock(pdf, "Blood Pressure", tempCanvas, margin, y, 180, 60);

    pdf.save(`Ball_${currentBall}_Report.pdf`);
  }

  async function downloadOverPDF(over, balls, avg, top, overAlertsCounts) {
    const JSPDF = await getJsPDF();
    if (!JSPDF) { alert("jsPDF not available. Install 'jspdf' or add the CDN."); return; }

    const pdf = new JSPDF("p", "mm", "a4");
    const margin = 10;
    let y = 16;

    const modeNow = sessionRef.current.mode || bowlingType || "-";
    const limits = getLimitsForMode(modeNow);

    pdf.setFont("Helvetica", "bold").setFontSize(16);
    pdf.text(`Over ${over} Report – Cricket Bowler`, margin, y); y += 8;
    pdf.setFontSize(11).setFont("Helvetica", "normal");
    y = addKV(pdf, margin, y, [
      ["Mode", modeNow],
      ["Balls in Over", String(balls.length)],
      ["Average Speed", `${avg.toFixed(1)} km/h`],
      ["Top Speed", `${top.toFixed(1)} km/h`]
    ]);

    y = addSafetySection(pdf, margin, y, modeNow, limits, overAlertsCounts);

  // Mode-specific coaching suggestions
  y = addSuggestionsSection(pdf, margin, y, modeNow);

    y = await addCanvasBlock(pdf, "Wrist (Accel, Angle)", wristCanvas.current, margin, y, 180, 60);
    y = await addCanvasBlock(pdf, "Elbow (Accel, Angle)", elbowCanvas.current, margin, y, 180, 60);
    y = await addCanvasBlock(pdf, "Spine (Accel, Angle)", spineCanvas.current, margin, y, 180, 60);
    y = await addCanvasBlock(pdf, "Vitals (HR, SPO2, SYS, DIA)", vCanvas.current, margin, y, 180, 60);

    pdf.save(`Over_${over}_${sessionRef.current.id || "session"}.pdf`);
  }

  async function downloadSessionReport() {
    const JSPDF = await getJsPDF();
    if (!JSPDF) { alert("jsPDF not available. Install 'jspdf' or add the CDN."); return; }

    const pdf = new JSPDF("p", "mm", "a4");
    const margin = 10;
    let y = 16;

    const s = sessionRef.current || session;
  const analytics = computeAnalytics(s.data);
    const modeNow = s.mode || bowlingType || "-";
    const limits = getLimitsForMode(modeNow);

    pdf.setFont("Helvetica", "bold").setFontSize(16);
    pdf.text("Final Session Analytics – Cricket Bowler", margin, y); y += 8;
    pdf.setFontSize(11).setFont("Helvetica", "normal");
    y = addKV(pdf, margin, y, [
      ["Session ID", s.id || "-"],
      ["Mode", modeNow],
      ["Duration", `${SESSION_SECS}s`],
      ["Total Balls (global counter)", String(ballCount)]
    ]);

    pdf.setFont("Helvetica","bold").text("Session Scores", margin, y); y += 6;
    pdf.setFont("Helvetica","normal");
    y = addKV(pdf, margin, y, [
      ["Consistency", `${analytics.scores.consistency}/100`],
      ["Stamina", `${analytics.scores.stamina}/100`],
      ["Overall", `${analytics.scores.overall}/100`]
    ]);

    y = addSafetySection(pdf, margin, y, modeNow, limits, alertCountsRef.current);

  // Mode-specific coaching suggestions for the session report
  y = addSuggestionsSection(pdf, margin, y, modeNow);

  // Historical Comparison removed from PDF per request

    const { wAng, eAng, sAng } = analytics.stats;
    pdf.setFont("Helvetica","bold").text("Angles & Posture Summary", margin, y); y += 6;
    y = addKV(pdf, margin, y, [
      ["Wrist Angle (avg / std)", `${wAng.avg?.toFixed?.(1) ?? "-"}° / ${wAng.std?.toFixed?.(1) ?? "-"}`],
      ["Elbow Angle (avg / std)", `${eAng.avg?.toFixed?.(1) ?? "-"}° / ${eAng.std?.toFixed?.(1) ?? "-"}`],
      ["Spine Angle (avg / std)", `${sAng.avg?.toFixed?.(1) ?? "-"}° / ${sAng.std?.toFixed?.(1) ?? "-"}`]
    ]);

    y = await addCanvasBlock(pdf, "Wrist (Accel, Angle)", wristCanvas.current, margin, y, 180, 60);
    
    // Page 2: Elbow chart
    pdf.addPage();
    y = 16;
    y = await addCanvasBlock(pdf, "Elbow (Accel, Angle)", elbowCanvas.current, margin, y, 180, 60);
    
    // Page 3: Spine chart
    pdf.addPage();
    y = 16;
    y = await addCanvasBlock(pdf, "Spine (Accel, Angle)", spineCanvas.current, margin, y, 180, 60);
    
    // Page 4: Vitals chart
    pdf.addPage();
    y = 16;
    y = await addCanvasBlock(pdf, "Vitals (HR, SPO2, SYS, DIA)", vCanvas.current, margin, y, 180, 60);

    pdf.addPage();
    y = 16;
    
    pdf.setFont("Helvetica","bold").setFontSize(14);
    pdf.text("Environmental & Vital Metrics", margin, y); y += 10;

    // Page 1: Temperature and Humidity
    y = await addCanvasBlock(pdf, "Temperature", tempCanvas.current, margin, y, 180, 60);
    y += 5;
    y = await addCanvasBlock(pdf, "Humidity", humidityCanvas.current, margin, y, 180, 60);
    
    // Page 2: Heart Rate and SpO2
    pdf.addPage();
    y = 16;
    y = await addCanvasBlock(pdf, "Heart Rate", hrCanvas.current, margin, y, 180, 60);
    y += 5;
    y = await addCanvasBlock(pdf, "Blood Oxygen (SpO2)", spo2Canvas.current, margin, y, 180, 60);
    
    // Page 3: Blood Pressure
    pdf.addPage();
    y = 16;
    y = await addCanvasBlock(pdf, "Blood Pressure", bpCanvas.current, margin, y, 180, 60);

    pdf.addPage();
    y = 16;
    
    // Build comprehensive over summary from per-ball data
    const allOvers = [];
    
    if (perBallDataRef.current.length > 0) {
      console.log('Building over summary from per-ball data...');
      const ballsByOver = {};
      
      // Group balls by over (every 6 balls = 1 over)
      perBallDataRef.current.forEach(ball => {
        const overNum = Math.ceil(ball.ballNum / 6);
        if (!ballsByOver[overNum]) {
          ballsByOver[overNum] = [];
        }
        ballsByOver[overNum].push(ball.kmph);
      });
      
      // Create over entries with proper calculations
      Object.keys(ballsByOver).sort((a, b) => Number(a) - Number(b)).forEach(overNum => {
        const balls = ballsByOver[overNum];
        const validBalls = balls.filter(b => b > 0);
        const avg = validBalls.length > 0 ? validBalls.reduce((a,b)=>a+b,0)/validBalls.length : 0;
        const top = validBalls.length > 0 ? Math.max(...validBalls) : 0;
        const incomplete = balls.length < 6;
        allOvers.push({ over: Number(overNum), avg, top, balls, incomplete });
      });
      console.log('Generated overs:', allOvers);
    } else {
      // Fallback to sessionOversRef if no per-ball data
      allOvers.push(...sessionOversRef.current);
      
      // Add incomplete over from tracking
      if (overSpeedsRef.current.length > 0) {
        const balls = overSpeedsRef.current;
        const over = overNumRef.current;
        const validBalls = balls.filter(b => b > 0);
        const avg = validBalls.length > 0 ? validBalls.reduce((a,b)=>a+b,0)/validBalls.length : 0;
        const top = validBalls.length > 0 ? Math.max(...validBalls) : 0;
        allOvers.push({ over, avg, top, balls, incomplete: true });
      }
    }
    
    console.log(`Final Report - Total overs: ${allOvers.length}, sessionOversRef: ${sessionOversRef.current.length}, overSpeedsRef: ${overSpeedsRef.current.length}`, allOvers);
    y = addOverTable(pdf, margin, y, allOvers);

    pdf.save(`Session_${s.id || "final"}.pdf`);
  }

  // Track incomplete overs when session ends (no auto-download)
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const was = prevActiveRef.current;
    if (was && !session.active) {
      if (overSpeedsRef.current.length > 0) {
        const balls = overSpeedsRef.current.slice();
        
        // Filter valid speeds for calculations
        const validBalls = balls.filter(b => b > 0);
        const avg = validBalls.length > 0 ? validBalls.reduce((a,b)=>a+b,0)/validBalls.length : 0;
        const top = validBalls.length > 0 ? Math.max(...validBalls) : 0;
        
        sessionOversRef.current.push({ over: overNumRef.current, avg, top, balls, incomplete: true });
        overSpeedsRef.current = [];
      }
      console.log('Session ended. Click "Download Final Report" or "Download Per Ball Report" to generate PDFs.');
    }
    prevActiveRef.current = session.active;
  }, [session.active]);

  /* ---------- UI ---------- */
  const limitsForUI = getLimitsForMode(session.mode || bowlingType || "-");
  return (
    <div className="wrap">
      {/* Toast container */}
      <div style={{
        position:"fixed", top:16, right:16, display:"flex", flexDirection:"column",
        gap:10, zIndex:9999, pointerEvents:"none"
      }}>
        {toasts.map(t => (
          <div key={t.id}
               style={{
                 pointerEvents:"auto",
                 minWidth:280,
                 maxWidth:420,
                 background:"rgba(20,20,20,.95)",
                 color:"#fff",
                 borderLeft:`4px solid ${toastColors[t.type] || "#2ecc71"}`,
                 boxShadow:"0 6px 20px rgba(0,0,0,.35)",
                 borderRadius:12,
                 padding:"10px 12px"
               }}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
              <div style={{fontWeight:700, letterSpacing:.2}}>{t.title}</div>
              <button
                onClick={()=>dismissToast(t.id)}
                style={{background:"transparent", color:"#fff", border:"none", fontSize:18, cursor:"pointer"}}
                aria-label="Dismiss"
              >&times;</button>
            </div>
            <div style={{fontFamily:"ui-monospace, Menlo, monospace", fontSize:12, lineHeight:1.5}}>
              {t.lines.map((ln,i)=> <div key={i}>{ln || "\u00A0"}</div>)}
            </div>
          </div>
        ))}
      </div>

      <header className="topbar">
        <h1>Cricket Bowler – Live Dashboard</h1>
        <div className={`status-pill ${statusClass}`}>{statusText}</div>
      </header>

      <main className="grid">
        {/* Bowling type + session controls */}
        <div className="card">
          <div className="card-head">
            <h3>Bowling Type</h3>
            <div className="controls">
              {isRecording ? (
                <span className="mono small" style={{color: "#e74c3c", fontWeight: "bold"}}>⏺ Recording {recordingCountdown}s ({bowlingType})</span>
              ) : session.active ? (
                <span className="mono small">Recording {session.secs}/{SESSION_SECS}s ({session.mode})</span>
              ) : null}
              <button className="btn primary" onClick={downloadSessionReport}>Download Final Report</button>
              {ballCount > 0 && (
                <button className="btn" onClick={downloadPerBallReport} style={{marginLeft: 8}}>Download Per Ball Report</button>
              )}
            </div>
          </div>
          <div className="card-body btn-row">
            {MODES.map((m) => (
              <button
                key={m}
                className={`btn chip ${bowlingType === m ? "primary" : ""}`}
                onClick={() => setBowlingType(m)}
                title={m}
                disabled={isRecording}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Smart Feedback card */}
        <div className="card" style={{ borderColor: liveIssues.length ? "#e74c3c" : "#2ecc71" }}>
          <div className="card-head">
            <h3>Smart Feedback</h3>
          </div>
          <div className="card-body">
            <div className="mono small" style={{marginBottom:8}}>
              Recommended ranges for <b>{session.mode || bowlingType || "-"}</b>:
              &nbsp;Wrist <b>{formatRange(limitsForUI.wrist)}</b> ·
              &nbsp;Elbow <b>{formatRange(limitsForUI.elbow)}</b> ·
              &nbsp;Spine <b>{formatRange(limitsForUI.spine)}</b>
            </div>
            {liveIssues.length ? (
              <ul style={{color:"#e74c3c", marginLeft:16}}>
                {liveIssues.map((m,i)=><li key={i}>{m}</li>)}
              </ul>
            ) : (
              <div style={{color:"#2ecc71"}}>All angles within safe ranges ✔</div>
            )}
          </div>
        </div>

        {/* Bowling stats */}
        <div className="card">
          <div className="card-head">
            <h3>Bowling Stats</h3>
            <div className="controls">
              <label className="mono small" style={{marginRight:12}}>
                Gate distance (m):{" "}
                <input
                  type="number" step="0.1" min="0.5" max="30"
                  value={distM}
                  onChange={(e)=>setDistM(Number(e.target.value)||2)}
                  style={{width:80}}
                />
              </label>
              <button
                className="btn"
                onClick={()=>{
                  const db = getDatabase();
                  set(ref(db, `${BASE_PATH}/ball_stats/count`), 0);
                  set(ref(db, `${BASE_PATH}/ball_stats/last_speed_kmph`), 0);
                  setBallCount(0);
                  setLastSpeedKmph(null);
                  prevBallCountRef.current = 0;
                  prevSpeedRef.current = null;
                  overNumRef.current = 1;
                  overSpeedsRef.current = [];
                  sessionOversRef.current = [];
                  perBallDataRef.current = [];
                  alertCountsRef.current = { wrist: 0, elbow: 0, spine: 0 };
                  overAlertCountsRef.current = { wrist: 0, elbow: 0, spine: 0 };
                  sessionAlertsRef.current = [];
                }}
              >
                Reset Count
              </button>
            </div>
          </div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">Balls</td><td className="v">{ballCount}</td></tr>
              <tr><td className="k">Last speed</td><td className="v">{lastSpeedKmph ? `${lastSpeedKmph.toFixed(1)} km/h` : "-"}</td></tr>
              <tr><td className="k">Distance</td><td className="v">{distM.toFixed(1)} m</td></tr>
            </tbody></table>
          </div>
        </div>

        {/* Environment */}
        <div className="card">
          <div className="card-head"><h3>Environment</h3></div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">Temp</td><td className="v">{String(temp ?? "-")}</td></tr>
              <tr><td className="k">Humidity</td><td className="v">{String(hum ?? "-")}</td></tr>
            </tbody></table>
          </div>
        </div>

        {/* Wrist / Elbow / Spine tables */}
        <div className="card">
          <div className="card-head"><h3>Wrist</h3></div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">Accel</td><td className="v">{String(wrist?.A ?? "-")}</td></tr>
              <tr><td className="k">Angle</td><td className="v">{String(wrist?.Angle ?? "-")}</td></tr>
            </tbody></table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Elbow</h3></div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">Accel</td><td className="v">{String(elbow?.A ?? "-")}</td></tr>
              <tr><td className="k">Angle</td><td className="v">{String(elbow?.Angle ?? "-")}</td></tr>
            </tbody></table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Spine</h3></div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">Accel</td><td className="v">{String(spine?.A ?? "-")}</td></tr>
              <tr><td className="k">Angle</td><td className="v">{String(spine?.Angle ?? "-")}</td></tr>
            </tbody></table>
          </div>
        </div>

        {/* Vitals */}
        <div className="card">
          <div className="card-head"><h3>Vitals</h3></div>
          <div className="card-body">
            <table className="kv"><tbody>
              <tr><td className="k">HR</td><td className="v">{String(hr ?? "-")}</td></tr>
              <tr><td className="k">SPO2</td><td className="v">{String(spo2 ?? "-")}</td></tr>
              <tr><td className="k">BP</td><td className="v">{String(bp ?? "-")}</td></tr>
            </tbody></table>
          </div>
        </div>

        {/* Graphs */}
        <div className="card">
          <div className="card-head"><h3>Wrist – Graph</h3></div>
          <div className="card-body"><canvas ref={wristCanvas} className="chart" width="800" height="240"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Elbow – Graph</h3></div>
          <div className="card-body"><canvas ref={elbowCanvas} className="chart" width="800" height="240"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Spine – Graph</h3></div>
          <div className="card-body"><canvas ref={spineCanvas} className="chart" width="800" height="240"/></div>
        </div>

        <div className="card wide">
          <div className="card-head"><h3>Vitals – Graph</h3></div>
          <div className="card-body"><canvas ref={vCanvas} className="chart" width="1100" height="260"/></div>
        </div>

        {/* Environmental & Vital Metrics - Individual Graphs */}
        <div className="card">
          <div className="card-head"><h3>Temperature – Graph</h3></div>
          <div className="card-body"><canvas ref={tempCanvas} className="chart" width="800" height="200"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Humidity – Graph</h3></div>
          <div className="card-body"><canvas ref={humidityCanvas} className="chart" width="800" height="200"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Heart Rate – Graph</h3></div>
          <div className="card-body"><canvas ref={hrCanvas} className="chart" width="800" height="200"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Blood Oxygen (SpO2) – Graph</h3></div>
          <div className="card-body"><canvas ref={spo2Canvas} className="chart" width="800" height="200"/></div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Blood Pressure – Graph</h3></div>
          <div className="card-body"><canvas ref={bpCanvas} className="chart" width="800" height="200"/></div>
        </div>

        {/* Live Video (optional) – your block was commented out */}
      </main>

      <footer className="foot">Listening at /{SENSORS_PATH} | Backend API: {BACKEND_API}</footer>
    </div>
  );
}
