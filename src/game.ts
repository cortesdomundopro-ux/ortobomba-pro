import { ANIMALS } from "./animals";
import { Q, type Question } from "./questions";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA7bNETm-vYNo4wKmWEFqbxL00EPtilO2k",
  authDomain: "ortobomba-2d1d9.firebaseapp.com",
  databaseURL: "https://ortobomba-2d1d9-default-rtdb.firebaseio.com",
  projectId: "ortobomba-2d1d9",
  storageBucket: "ortobomba-2d1d9.firebasestorage.app",
  messagingSenderId: "797890574922",
  appId: "1:797890574922:web:c5b739f98ca16b079504b3"
};

const ADMIN_CODE: string =
  (import.meta as unknown as { env: Record<string, string | undefined> } ).env
    .VITE_ADMIN_CODE ?? "OB_ADMIN";
const TURN_DURATION = 10;
const MAX_PLAYERS = 6;

declare const firebase: any;

type Player = {
  id: string;
  nick: string;
  skinIndex: number;
  lives: number;
  score: number;
  online: boolean;
  joinedAt: number;
  eliminatedAt?: number | null;
};

type Room = {
  code: string;
  quick?: boolean;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  players: Record<string, Player>;
  currentTurn: string | null;
  currentQIndex: number | null;
  usedQ: number[];
  currentQ: Question | null;
  turnStartedAt: number;
  roundCount: number;
  eliminationOrder: string[];
  winnerId?: string | null;
  updatedAt?: number;
};

let db: any = null;
let ME = { nick: "", id: "", salaId: "", host: false, skinIndex: 0 };
let salaRef: any = null;
let reactionRef: any = null;
const sentReactionIds = new Set<string>();
let adminRef: any = null;
let bombTimerInterval: ReturnType<typeof setInterval> | null = null;
let particlesActive = true;
let muted = false;
let AC: AudioContext | null = null;
let GS: Room = emptyRoom("");
let prevTurnId: string | null = null;
let winnerSaved = false;
let timeoutLock = "";
let localMode = false;
let localRoom: Room | null = null;
let lastTickSecond: number | null = null;
let runtimePlayerId = uid();
const REACTION_EMOJIS = ["\u{1F602}", "\u{1F525}", "\u{1F4A3}"];
const REACTION_SPARKS = REACTION_EMOJIS;
const DEFAULT_REACTION = REACTION_EMOJIS[0];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function emptyRoom(code: string): Room {
  return {
    code,
    status: "lobby",
    hostId: "",
    players: {},
    currentTurn: null,
    currentQIndex: null,
    usedQ: [],
    currentQ: null,
    turnStartedAt: 0,
    roundCount: 1,
    eliminationOrder: [],
    winnerId: null
  };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} nao encontrado`);
  return node as T;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] ?? c)
  );
}

function attrEsc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeReactionEmoji(raw: string): string {
  const emoji = String(raw || "").trim();
  return REACTION_EMOJIS.includes(emoji) ? emoji : DEFAULT_REACTION;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now(): number {
  return Date.now();
}

function saveNick(n: string) {
  try { localStorage.setItem("ob_nick", n); } catch {}
}

function loadNick(): string {
  try { return localStorage.getItem("ob_nick") ?? ""; } catch { return ""; }
}

function getPlayerId(): string {
  return runtimePlayerId;
}

function resetPlayerId() {
  runtimePlayerId = uid();
  ME.id = runtimePlayerId;
}

function toast(msg: string, col = "#00d97e", d = 2500) {
  const t = el<HTMLDivElement>("toast");
  t.textContent = msg;
  t.style.background = col;
  t.style.color = "#fff";
  t.style.opacity = "1";
  clearTimeout((t as any)._t);
  (t as any)._t = setTimeout(() => { t.style.opacity = "0"; }, d);
}

function getAC(): AudioContext | null {
  if (muted) return null;
  if (!AC) {
    try { AC = new (window.AudioContext ?? (window as any).webkitAudioContext)(); } catch {}
  }
  return AC;
}

function playTick(urgent: boolean) {
  const ac = getAC();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = urgent ? "square" : "sine";
  o.frequency.setValueAtTime(urgent ? 1200 : 800, ac.currentTime);
  g.gain.setValueAtTime(0.1, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.05);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.05);
}

function playBoom() {
  const ac = getAC();
  if (!ac) return;
  const o1 = ac.createOscillator();
  const g1 = ac.createGain();
  o1.type = "sawtooth";
  o1.frequency.setValueAtTime(100, ac.currentTime);
  o1.frequency.exponentialRampToValueAtTime(20, ac.currentTime + 0.5);
  g1.gain.setValueAtTime(0.8, ac.currentTime);
  g1.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
  o1.connect(g1);
  g1.connect(ac.destination);
  o1.start();
  o1.stop(ac.currentTime + 0.8);
}

function playCorrect() {
  const ac = getAC();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(600, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(1200, ac.currentTime + 0.1);
  g.gain.setValueAtTime(0.2, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.2);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.2);
}

function playWin() {
  const ac = getAC();
  if (!ac) return;
  [660, 880, 1050, 1320].forEach((freq, i) => {
    const start = ac.currentTime + i * 0.1;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.2, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    o.connect(g);
    g.connect(ac.destination);
    o.start(start);
    o.stop(start + 0.35);
  });
}

(function initParticles() {
  const c = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const canvas = c;
  const context = ctx;
  let w = 0;
  let h = 0;
  let rafId = 0;
  const pts: { x: number; y: number; r: number; vx: number; vy: number; a: number }[] = [];
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();
  window.addEventListener("resize", () => {
    resize();
    start();
  });
  const count = prefersReducedMotion.matches ? 0 : 40;
  for (let i = 0; i < count; i++) {
    pts.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.25,
      a: Math.random() * Math.PI * 2
    });
  }
  function shouldRun() { return particlesActive && !document.hidden && !prefersReducedMotion.matches; }
  function start() { if (!rafId && shouldRun()) rafId = requestAnimationFrame(draw); }
  function stop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; context.clearRect(0, 0, w, h); }
  function draw() {
    rafId = 0;
    if (!shouldRun()) { stop(); return; }
    context.clearRect(0, 0, w, h);
    pts.forEach((p) => {
      p.x = (p.x + p.vx + w) % w;
      p.y = (p.y + p.vy + h) % h;
      p.a += 0.012;
      const op = 0.3 + 0.28 * Math.sin(p.a);
      context.beginPath();
      context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      context.fillStyle = `rgba(200,100,255,${op})`;
      context.fill();
    });
    rafId = requestAnimationFrame(draw);
  }
  (window as any).__setOrtoParticles = (active: boolean) => {
    particlesActive = active;
    if (active) start();
    else stop();
  };
  start();
})();

function setParticlesActive(active: boolean) {
  particlesActive = active;
  const controller = (window as any).__setOrtoParticles;
  if (typeof controller === "function") controller(active);
}

function initTiles() {
  const c = document.getElementById("setup-tiles-container");
  if (!c) return;
  c.innerHTML = "";
  [
    { l: "A", t: "8%", left: "3%", dur: "7.5s", del: "0s" },
    { l: "R", t: "30%", left: "3%", dur: "9s", del: "1s" },
    { l: "T", t: "60%", left: "4%", dur: "8s", del: "2s" },
    { l: "O", t: "10%", left: "87%", dur: "8.5s", del: "0.5s" },
    { l: "B", t: "40%", left: "90%", dur: "7s", del: "1.5s" },
    { l: "M", t: "70%", left: "86%", dur: "9.5s", del: "0.8s" }
  ].forEach(({ l, t, left, dur, del }) => {
    const d = document.createElement("div");
    d.className = "tile-letter";
    d.textContent = l;
    d.style.top = t;
    d.style.left = left;
    d.style.setProperty("--dur", dur);
    d.style.setProperty("--del", del);
    c.appendChild(d);
  });
}

function initFB(retries = 12) {
  try {
    if (typeof firebase === "undefined") {
      if (retries > 0) window.setTimeout(() => initFB(retries - 1), 200);
      return;
    }
    if (!firebase.apps?.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch { db = null; }
}

function showScreen(id: "setup" | "lobby" | "game" | "admin") {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el<HTMLDivElement>("scr-" + id).classList.add("active");
  el<HTMLDivElement>("emoji-menu").style.display = id === "game" ? "flex" : "none";
  setParticlesActive(id === "setup");
  if (AC && AC.state === "suspended") void AC.resume();
  if (id !== "game") stopTimer();
}

function getNickOrToast(): string | null {
  const input = el<HTMLInputElement>("nick-input");
  const nick = input.value.trim().slice(0, 15);
  if (!nick) {
    toast("Digite seu nick primeiro.", "#ff3535");
    input.focus();
    return null;
  }
  saveNick(nick);
  ME.nick = nick;
  ME.id = getPlayerId();
  return nick;
}

function makePlayer(nick: string, skinIndex?: number): Player {
  return {
    id: ME.id,
    nick,
    skinIndex: skinIndex ?? Math.floor(Math.random() * ANIMALS.length),
    lives: 3,
    score: 0,
    online: true,
    joinedAt: now(),
    eliminatedAt: null
  };
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function partidaRapida() {
  if (!getNickOrToast()) return;
  if (!db) { startLocalDemo(); return; }
  const snap = await db.ref("rooms").orderByChild("quick").equalTo(true).once("value");
  const rooms = (snap.val() ?? {}) as Record<string, Room>;
  const open = Object.values(rooms).find((r) => {
    const players = Object.values(r.players ?? {}).filter((p) => p.online);
    return r.status === "lobby" && players.length < MAX_PLAYERS;
  });
  if (open) await joinRoom(open.code);
  else await criarSala(true);
}

async function criarSala(quick = false) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!db) { startLocalDemo(); return; }
  const code = quick ? `RAP${roomCode().slice(0, 3)}` : roomCode();
  ME.salaId = code;
  ME.host = true;
  ME.skinIndex = Math.floor(Math.random() * ANIMALS.length);
  const player = makePlayer(nick, ME.skinIndex);
  const room: Room = {
    ...emptyRoom(code),
    quick,
    hostId: ME.id,
    players: { [ME.id]: player },
    updatedAt: now()
  };
  await db.ref(`rooms/${code}`).set(room);
  listenRoom(code);
  showScreen("lobby");
}

async function entrarSala() {
  const code = el<HTMLInputElement>("code-input").value.trim().toUpperCase();
  if (!code) { toast("Digite o codigo da sala.", "#ff3535"); return; }
  await joinRoom(code);
}

async function joinRoom(code: string) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!db) { startLocalDemo(); return; }
  const ref = db.ref(`rooms/${code}`);
  const snap = await ref.once("value");
  const room = snap.val() as Room | null;
  if (!room) { toast("Sala nao encontrada.", "#ff3535"); return; }
  if (room.status !== "lobby") { toast("Essa sala ja esta em jogo.", "#ff3535"); return; }
  const players = Object.values(room.players ?? {}).filter((p) => p.online);
  if (room.players?.[ME.id]?.online) resetPlayerId();
  if (!room.players?.[ME.id] && players.length >= MAX_PLAYERS) { toast("Sala cheia.", "#ff3535"); return; }
  ME.salaId = code;
  ME.host = room.hostId === ME.id;
  ME.skinIndex = players.length % ANIMALS.length;
  await ref.child(`players/${ME.id}`).set(makePlayer(nick, ME.skinIndex));
  await ref.child("updatedAt").set(now());
  listenRoom(code);
  showScreen("lobby");
}

function listenRoom(code: string) {
  if (salaRef) salaRef.off();
  if (reactionRef) reactionRef.off();
  salaRef = db.ref(`rooms/${code}`);
  salaRef.on("value", (snap: any) => {
    const room = snap.val() as Room | null;
    if (!room) {
      cleanupRoom(false);
      toast("A sala foi encerrada.", "#ff3535");
      showScreen("setup");
      return;
    }
    GS = normalizeRoom(room);
    ME.host = GS.hostId === ME.id;
    if (GS.status === "lobby") { renderLobby(); showScreen("lobby"); }
    else if (GS.status === "playing") { renderGame(); showScreen("game"); }
    else { renderGame(); renderWin(); }
  });
  salaRef.child(`players/${ME.id}`).onDisconnect().update({ online: false });
  reactionRef = salaRef.child("reactions");
  reactionRef.limitToLast(1).on("child_added", (snap: any) => {
    const r = snap.val();
    if (!r || r.at < now() - 3000) return;
    if (r.localId && sentReactionIds.delete(r.localId)) return;
    showReaction(r.playerId, r.emoji);
  });
}

function normalizeRoom(room: Room): Room {
  return {
    ...emptyRoom(room.code),
    ...room,
    players: room.players ?? {},
    usedQ: room.usedQ ?? [],
    eliminationOrder: room.eliminationOrder ?? []
  };
}

function renderLobby() {
  el<HTMLDivElement>("lobby-code-val").textContent = GS.code;
  const list = el<HTMLDivElement>("players-list");
  const players = sortedPlayers(GS.players);
  list.innerHTML = players.map((p) => `
    <div class="player-row">
      <div class="mini-avatar">${ANIMALS[p.skinIndex % ANIMALS.length]}</div>
      <strong>${esc(p.nick)}</strong>
      ${p.id === GS.hostId ? `<span class="host-badge">HOST</span>` : ""}
    </div>
  `).join("");
  const start = el<HTMLButtonElement>("btn-start");
  if (ME.host) {
    start.disabled = players.length < 2;
    start.textContent = players.length < 2 ? "AGUARDANDO JOGADORES..." : "INICIAR PARTIDA";
  } else {
    start.disabled = true;
    start.textContent = "AGUARDANDO O HOST...";
  }
}

function sortedPlayers(players: Record<string, Player>): Player[] {
  return Object.values(players).filter((p) => p.online).sort((a, b) => a.joinedAt - b.joinedAt);
}

function alivePlayers(room: Room): Player[] {
  return Object.values(room.players).filter((p) => p.lives > 0 && p.online);
}

function chooseQuestion(used: number[]): { idx: number; q: Question; used: number[] } {
  const cleanUsed = used.filter((idx) => idx >= 0 && idx < Q.length);
  const available = Q.map((_, idx) => idx).filter((idx) => !cleanUsed.includes(idx));
  const pool = available.length ? available : Q.map((_, idx) => idx);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  const nextUsed = available.length ? [...cleanUsed, idx] : [idx];
  return { idx, q: Q[idx], used: nextUsed };
}

async function startGame() {
  if (localMode && localRoom) {
    localRoom = startRoomState(localRoom);
    GS = localRoom;
    renderGame();
    showScreen("game");
    return;
  }
  if (!ME.host || !salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  if (alivePlayers(room).length < 2) { toast("Precisa de pelo menos 2 jogadores.", "#ff3535"); return; }
  await salaRef.update(startRoomState(room));
}

function startRoomState(room: Room): Room {
  const players: Record<string, Player> = {};
  sortedPlayers(room.players).forEach((p) => {
    players[p.id] = { ...p, lives: 3, score: 0, eliminatedAt: null, online: true };
  });
  const first = sortedPlayers(players)[0];
  const { idx, q, used } = chooseQuestion([]);
  return {
    ...room,
    status: "playing",
    players,
    currentTurn: first?.id ?? null,
    currentQIndex: idx,
    currentQ: q,
    usedQ: used,
    turnStartedAt: now(),
    roundCount: 1,
    eliminationOrder: [],
    winnerId: null,
    updatedAt: now()
  };
}

function renderGame() {
  const circle = el<HTMLDivElement>("players-circle");
  const players = sortedPlayers(GS.players);
  const count = players.length;
  const isMobile = window.innerWidth < 600;
  const radius = isMobile ? 110 : 180;
  const arrow = el<HTMLDivElement>("turn-arrow");
  
  circle.querySelectorAll(".p-slot").forEach(s => s.remove());
  arrow.style.display = "none";
  el<HTMLSpanElement>("round-val").textContent = String(GS.roundCount || 1);

  players.forEach((p, i) => {
    const angle = (360 / count) * i - 90;
    const x = Math.cos((angle * Math.PI) / 180) * radius;
    const y = Math.sin((angle * Math.PI) / 180) * radius;
    const isTurn = p.id === GS.currentTurn;
    const isEliminated = p.lives <= 0;
    const isHost = p.id === GS.hostId;

    const slot = document.createElement("div");
    slot.className = `p-slot ${isTurn ? "active-turn" : ""} ${isEliminated ? "eliminated" : ""}`;
    slot.style.transform = `translate(${x}px, ${y}px)`;
    slot.dataset.playerId = p.id;
    
    slot.innerHTML = `
      <div class="p-avatar-wrap">
        ${isHost ? '<div class="p-crown">HOST</div>' : ''}
        ${ANIMALS[p.skinIndex % ANIMALS.length]}
      </div>
      <div class="p-name">${esc(p.nick)}</div>
      <div class="p-lives">${"&hearts;".repeat(p.lives)}</div>
    `;
    circle.appendChild(slot);
    
    if (isTurn) {
      arrow.style.display = "block";
      arrow.style.transform = `rotate(${angle + 90}deg)`;
    }
  });

  if (GS.currentTurn === ME.id && GS.status === "playing") {
    renderQuestion();
  } else {
    el<HTMLDivElement>("q-card").style.display = "none";
  }
}

function renderQuestion() {
  const q = GS.currentQ;
  if (!q) return;
  const card = el<HTMLDivElement>("q-card");
  card.style.display = "block";
  el<HTMLDivElement>("q-cat").textContent = q.cat.toUpperCase();
  
  const wordDisplay = q.word.replace(/__/g, ' <span class="q-blank-pro">__</span> ').replace(/_/g, ' <span class="q-blank-pro">_</span> ');
  el<HTMLDivElement>("q-word").innerHTML = wordDisplay;

  const ops = el<HTMLDivElement>("opcoes");
  ops.innerHTML = "";
  q.options.forEach((o) => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = o;
    btn.onclick = () => void submitAnswer(o);
    ops.appendChild(btn);
  });
  
  startTimer();
}

function startTimer() {
  stopTimer();
  bombTimerInterval = setInterval(updateTimer, 100);
}

function stopTimer() {
  if (bombTimerInterval) clearInterval(bombTimerInterval);
  bombTimerInterval = null;
}

function updateTimer() {
  if (GS.status !== "playing") { stopTimer(); return; }
  
  const baseDuration = Math.max(3, 10.5 - ((GS.roundCount || 1) * 0.5));
  const elapsed = (now() - GS.turnStartedAt) / 1000;
  const remaining = Math.max(0, Math.ceil(baseDuration - elapsed));
  
  const timer = el<HTMLDivElement>("bomb-timer");
  timer.textContent = String(remaining).padStart(2, "0");
  timer.classList.toggle("danger", remaining <= 3);
  
  if (remaining <= 3 && remaining > 0) {
    document.querySelectorAll(".p-avatar-wrap").forEach(av => av.classList.add("panic"));
  } else {
    document.querySelectorAll(".p-avatar-wrap").forEach(av => av.classList.remove("panic"));
  }

  if (remaining <= 5 && remaining > 0 && Math.floor(elapsed * 10) % 10 === 0) {
    playTick(remaining <= 3);
  }

  if (remaining <= 0 && (ME.host || localMode)) {
    stopTimer();
    void handleTimeout();
  }
}

async function handleTimeout() {
  playBoom();
  if (localMode && localRoom) {
    const nextState = applyAnswerToRoom(localRoom, GS.currentTurn ?? "", false);
    localRoom = { ...localRoom, ...nextState };
    GS = localRoom;
    afterRoomMutation();
  } else if (salaRef) {
    const snap = await salaRef.once("value");
    const room = normalizeRoom(snap.val());
    await salaRef.update(applyAnswerToRoom(room, room.currentTurn ?? "", false));
  }
}

async function submitAnswer(ans: string) {
  const isCorrect = ans.toLowerCase() === GS.currentQ?.answer.toLowerCase();
  if (isCorrect) playCorrect();
  else playBoom();

  if (localMode && localRoom) {
    const nextState = applyAnswerToRoom(localRoom, ME.id, isCorrect);
    localRoom = { ...localRoom, ...nextState };
    GS = localRoom;
    afterRoomMutation();
  } else if (salaRef) {
    const snap = await salaRef.once("value");
    const room = normalizeRoom(snap.val());
    await salaRef.update(applyAnswerToRoom(room, ME.id, isCorrect));
  }
}

function applyAnswerToRoom(room: Room, playerId: string, correct: boolean): Room {
  const players = { ...room.players };
  const player = players[playerId];
  if (!player) return room;

  if (!correct) {
    player.lives -= 1;
    if (player.lives <= 0) {
      player.eliminatedAt = now();
      room.eliminationOrder = [...(room.eliminationOrder || []), playerId];
    }
  } else {
    player.score += 10;
  }

  const alive = Object.values(players).filter(p => p.lives > 0 && p.online);
  if (alive.length <= 1) {
    return {
      ...room,
      players,
      status: "finished",
      winnerId: alive[0]?.id ?? playerId,
      updatedAt: now()
    };
  }

  const sortedIds = sortedPlayers(players).map(p => p.id);
  const aliveIds = alive.map(p => p.id);
  let currentIndex = sortedIds.indexOf(playerId);
  let nextId = "";
  let newRound = room.roundCount || 1;

  for (let i = 1; i <= sortedIds.length; i++) {
    const nextIdx = (currentIndex + i) % sortedIds.length;
    if (nextIdx === 0) newRound++;
    const candidate = sortedIds[nextIdx];
    if (aliveIds.includes(candidate)) {
      nextId = candidate;
      break;
    }
  }

  const { idx, q, used } = chooseQuestion(room.usedQ);
  return {
    ...room,
    players,
    currentTurn: nextId,
    currentQIndex: idx,
    currentQ: q,
    usedQ: used,
    turnStartedAt: now(),
    roundCount: newRound,
    updatedAt: now()
  };
}

function afterRoomMutation() {
  if (GS.status === "playing") renderGame();
  else renderWin();
}

function renderWin() {
  stopTimer();
  const overlay = el<HTMLDivElement>("win-overlay");
  const winner = GS.winnerId ? GS.players[GS.winnerId] : null;
  el<HTMLDivElement>("winner-name").textContent = winner?.nick ?? "Sem vencedor";
  overlay.style.display = "flex";
  if (!winnerSaved) { winnerSaved = true; playWin(); }
}

async function jogarNovamente() {
  el<HTMLDivElement>("win-overlay").style.display = "none";
  winnerSaved = false;
  if (localMode && localRoom) {
    localRoom = startRoomState(localRoom);
    GS = localRoom;
    afterRoomMutation();
    return;
  }
  if (!ME.host || !salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  await salaRef.update(startRoomState(room));
}

function showReaction(playerId: string, emoji: string) {
  const slot = document.querySelector<HTMLElement>(`.p-slot[data-player-id="${attrEsc(playerId)}"]`);
  if (!slot) return;
  const pop = document.createElement("div");
  pop.className = "reaction-pop";
  pop.textContent = normalizeReactionEmoji(emoji);
  slot.appendChild(pop);
  setTimeout(() => pop.remove(), 2000);
}

async function sendReaction(emoji: string) {
  if (!ME.id) return;
  showReaction(ME.id, emoji);
  if (localMode || !reactionRef) return;
  await reactionRef.push({ playerId: ME.id, emoji, at: now() });
}

async function copiarCodigo() {
  const code = ME.salaId || GS.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast("Codigo copiado."); }
  catch { toast(code); }
}

function cleanupRoom(updateRemote = true) {
  stopTimer();
  if (salaRef) {
    salaRef.off();
    if (updateRemote && ME.id) salaRef.child(`players/${ME.id}`).update({ online: false });
  }
  salaRef = null;
  reactionRef = null;
  localMode = false;
  ME.salaId = "";
  ME.host = false;
}

async function sairSala() {
  const roomCode = ME.salaId;
  const wasHost = ME.host;
  const ref = salaRef;

  if (localMode) {
    cleanupRoom(false);
    localRoom = null;
    GS = emptyRoom("");
    showScreen("setup");
    return;
  }

  cleanupRoom(false);
  showScreen("setup");

  if (!ref || !ME.id) return;
  try {
    if (wasHost) {
      const snap = await ref.once("value");
      const room = normalizeRoom(snap.val() ?? emptyRoom(roomCode));
      const remaining = sortedPlayers(room.players).filter((p) => p.id !== ME.id);
      if (!remaining.length) {
        await ref.remove();
        return;
      }
      await ref.update({
        hostId: remaining[0].id,
        [`players/${ME.id}/online`]: false,
        updatedAt: now()
      });
      return;
    }
    await ref.child(`players/${ME.id}`).update({ online: false });
    await ref.child("updatedAt").set(now());
  } catch {
    toast("Nao foi possivel sair da sala agora.", "#ff3535");
  }
}

async function adminPanel() {
  const code = prompt("Codigo admin:");
  if (code !== ADMIN_CODE) { toast("Codigo admin incorreto.", "#ff3535"); return; }
  showScreen("admin");
  await renderAdmin();
}

async function renderAdmin() {
  if (!db) return;
  if (adminRef) adminRef.off();
  adminRef = db.ref("rooms");
  adminRef.on("value", (snap: any) => {
    const rooms = (snap.val() ?? {}) as Record<string, Room>;
    const arr = Object.values(rooms);
    el<HTMLDivElement>("stat-rooms").textContent = String(arr.length);
    el<HTMLDivElement>("admin-rooms-list").innerHTML = arr.map((r) => `
      <div class="room-card">
        <div class="room-title">${esc(r.code)} - ${esc(r.status)}</div>
        <div class="room-players">
          ${Object.values(r.players ?? {}).map((p) => `<span class="p-badge">${esc(p.nick)}</span>`).join("")}
        </div>
      </div>
    `).join("") || "Nenhuma sala.";
  });
}

function startLocalDemo() {
  const nick = getNickOrToast();
  if (!nick) return;
  localMode = true; ME.host = true; ME.salaId = "LOCAL";
  const players: Record<string, Player> = {
    [ME.id]: makePlayer(nick, 0),
    "bot-1": { ...makePlayer("Lila", 1), id: "bot-1" }
  };
  localRoom = { ...emptyRoom("LOCAL"), hostId: ME.id, players };
  GS = localRoom;
  renderLobby();
  showScreen("lobby");
}

function bindEvents() {
  el<HTMLButtonElement>("btn-rapida").onclick = () => void partidaRapida();
  el<HTMLButtonElement>("btn-criar").onclick = () => void criarSala(false);
  el<HTMLButtonElement>("btn-entrar").onclick = () => void entrarSala();
  el<HTMLButtonElement>("btn-start").onclick = () => void startGame();
  el<HTMLButtonElement>("btn-admin").onclick = () => void adminPanel();
  el<HTMLButtonElement>("btn-jogar-novamente").onclick = () => void jogarNovamente();
  el<HTMLButtonElement>("btn-copiar").onclick = () => void copiarCodigo();
  el<HTMLButtonElement>("btn-sair-lobby").onclick = () => void sairSala();
  el<HTMLButtonElement>("btn-sair-jogo").onclick = () => void sairSala();
  el<HTMLButtonElement>("btn-admin-voltar").onclick = () => showScreen("setup");
  el<HTMLButtonElement>("btn-mute").onclick = () => {
    muted = !muted;
    el<HTMLButtonElement>("btn-mute").textContent = muted ? "Mudo" : "Som";
  };
  el<HTMLButtonElement>("btn-limpar").onclick = async () => {
    if (!db) return;
    if (!confirm("Limpar todas as salas?")) return;
    await db.ref("rooms").remove();
    toast("Salas limpas.");
  };
  document.querySelectorAll<HTMLElement>(".emoji-btn").forEach((btn) => {
    btn.onclick = () => void sendReaction(btn.dataset.emoji ?? DEFAULT_REACTION);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initFB();
  const saved = loadNick();
  if (saved) el<HTMLInputElement>("nick-input").value = saved;
  initTiles();
  bindEvents();
});
