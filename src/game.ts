import { ANIMALS, AVATAR_IMAGES, BODY_IMAGES } from "./animals";
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
const PLAYER_STALE_MS = 35_000;
const BOMB_PASS_MS = 940;
const AVATAR_BODY_PALETTES = [
  { shirt: "#7a35ff", shirt2: "#4c1ccf", pants: "#20304f", shoe: "#ff7a1c", skin: "#f4b18f" },
  { shirt: "#ff6fae", shirt2: "#26c6da", pants: "#27324f", shoe: "#ff82a9", skin: "#a85f38" },
  { shirt: "#ff8a18", shirt2: "#ffcf3f", pants: "#24304d", shoe: "#39d0ff", skin: "#c77334" },
  { shirt: "#35d6b4", shirt2: "#ff73a8", pants: "#2b2f55", shoe: "#ffd23d", skin: "#d88a5a" },
  { shirt: "#2fd56f", shirt2: "#ffe44f", pants: "#1f3762", shoe: "#ff7b2f", skin: "#b66b32" },
  { shirt: "#f5f5ff", shirt2: "#111827", pants: "#303a54", shoe: "#70e0ff", skin: "#e5b28f" }
];
const BODY_IMAGE_FILTERS = [
  "none",
  "none",
  "none",
  "none",
  "hue-rotate(148deg) saturate(1.18) brightness(1.04)",
  "hue-rotate(34deg) saturate(1.22) brightness(1.05)"
];

declare const firebase: any;

type Player = {
  id: string;
  nick: string;
  skinIndex: number;
  lives: number;
  score: number;
  online: boolean;
  joinedAt: number;
  seenAt?: number;
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

type BombPoint = {
  x: number;
  y: number;
};

type PlayerVisualState =
  | "idle"
  | "holdingBomb"
  | "catchingBomb"
  | "throwingBomb"
  | "hit"
  | "victory"
  | "defeat";

let db: any = null;
let ME = { nick: "", id: "", salaId: "", host: false, skinIndex: 0 };
let salaRef: any = null;
let reactionRef: any = null;
const sentReactionIds = new Set<string>();
let adminRef: any = null;
let bombTimerInterval: ReturnType<typeof setInterval> | null = null;
let presenceInterval: ReturnType<typeof setInterval> | null = null;
let particlesActive = true;
let muted = false;
let AC: AudioContext | null = null;
let GS: Room = emptyRoom("");
let prevTurnId: string | null = null;
let activeBombPass: Animation | null = null;
let winnerSaved = false;
let timeoutLock = "";
let localMode = false;
let localRoom: Room | null = null;
let lastTickSecond: number | null = null;
let reactionEventsBound = false;
let lastRoomSignature = "";
let runtimePlayerId = uid();
const REACTION_EMOJIS = ["\u{1F602}", "\u{1F525}", "\u{1F4A3}"];
const REACTION_SPARKS = REACTION_EMOJIS;
const DEFAULT_REACTION = REACTION_EMOJIS[0];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const previousLives = new Map<string, number>();
const SLOT_COLORS = ["#00d9ff", "#35f06b", "#ffc700", "#d946ff", "#00f5d4", "#ff2d74"];

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

function skinIndexOf(skinIndex: number): number {
  return ((skinIndex % ANIMALS.length) + ANIMALS.length) % ANIMALS.length;
}

function avatarHtml(skinIndex: number): string {
  const idx = skinIndexOf(skinIndex);
  const src = AVATAR_IMAGES[idx];
  const fallback = `<span class="avatar-fallback">${ANIMALS[idx]}</span>`;
  if (!src) return `<span class="avatar-head">${fallback}</span>`;
  return `<span class="avatar-head">${fallback}<img class="avatar-art" src="${esc(src)}" alt="" draggable="false" loading="eager" onload="this.previousElementSibling.style.display='none'" onerror="this.style.display='none';this.previousElementSibling.style.display='block'"></span>`;
}

function bodyImageSrc(skinIndex: number): string {
  return BODY_IMAGES[skinIndexOf(skinIndex)] ?? "";
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
  if (id === "game") bindReactionButtons();
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
  const stamp = now();
  return {
    id: ME.id,
    nick,
    skinIndex: skinIndex ?? Math.floor(Math.random() * ANIMALS.length),
    lives: 3,
    score: 0,
    online: true,
    joinedAt: stamp,
    seenAt: stamp,
    eliminatedAt: null
  };
}

function isFreshPlayer(p?: Player | null): p is Player {
  if (!p || !p.online) return false;
  const seen = Number(p.seenAt || 0);
  if (!seen) return now() - Number(p.joinedAt || 0) <= PLAYER_STALE_MS;
  return now() - seen <= PLAYER_STALE_MS;
}

function nextSkinIndex(players: Player[], preferred = players.length): number {
  const used = new Set(players.map((p) => ((p.skinIndex % ANIMALS.length) + ANIMALS.length) % ANIMALS.length));
  for (let i = 0; i < ANIMALS.length; i++) {
    const idx = (preferred + i) % ANIMALS.length;
    if (!used.has(idx)) return idx;
  }
  return preferred % ANIMALS.length;
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
    const host = r.players?.[r.hostId];
    return r.status === "lobby" && players.length < MAX_PLAYERS && isFreshPlayer(host);
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
  const existingPlayer = room.players?.[ME.id];
  if (existingPlayer?.online) {
    ME.skinIndex = existingPlayer.skinIndex;
  } else {
    if (players.length >= MAX_PLAYERS) { toast("Sala cheia.", "#ff3535"); return; }
    ME.skinIndex = nextSkinIndex(players);
  }
  ME.salaId = code;
  ME.host = room.hostId === ME.id;
  await ref.child(`players/${ME.id}`).update({
    ...makePlayer(nick, ME.skinIndex),
    joinedAt: existingPlayer?.joinedAt ?? now()
  });
  await ref.child("updatedAt").set(now());
  listenRoom(code);
  showScreen("lobby");
}

function touchPresence() {
  if (!salaRef || !ME.id) return;
  void salaRef.child(`players/${ME.id}`).update({ online: true, seenAt: now() });
}

function startPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  touchPresence();
  presenceInterval = window.setInterval(touchPresence, 8_000);
}

function recoverLobbyHost(room: Room) {
  if (!salaRef || room.status !== "lobby") return;
  const players = sortedPlayers(room.players);
  if (!players.length) return;
  if (isFreshPlayer(room.players?.[room.hostId])) return;
  const nextHost = players.find((p) => p.id === ME.id || isFreshPlayer(p)) ?? players[0];
  if (!nextHost || nextHost.id === room.hostId) return;
  void salaRef.update({ hostId: nextHost.id, updatedAt: now() });
}

function listenRoom(code: string) {
  if (salaRef) salaRef.off();
  if (reactionRef) reactionRef.off();
  if (presenceInterval) clearInterval(presenceInterval);
  lastRoomSignature = "";
  salaRef = db.ref(`rooms/${code}`);
  salaRef.on("value", (snap: any) => {
    const room = snap.val() as Room | null;
    if (!room) {
      cleanupRoom(false);
      toast("A sala foi encerrada.", "#ff3535");
      showScreen("setup");
      return;
    }
    const nextRoom = normalizeRoom(room);
    recoverLobbyHost(nextRoom);
    const nextSignature = roomRenderSignature(nextRoom);
    if (lastRoomSignature === nextSignature) {
      GS = nextRoom;
      return;
    }
    lastRoomSignature = nextSignature;
    GS = nextRoom;
    ME.host = GS.hostId === ME.id;
    if (GS.status === "lobby") { renderLobby(); showScreen("lobby"); }
    else if (GS.status === "playing") { renderGame(); showScreen("game"); }
    else { renderGame(); renderWin(); }
  });
  salaRef.child(`players/${ME.id}`).onDisconnect().update({ online: false });
  startPresence();
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

function roomRenderSignature(room: Room): string {
  const players = sortedPlayers(room.players).map((p) => [
    p.id,
    p.nick,
    p.skinIndex,
    p.lives,
    p.score,
    p.online,
    p.eliminatedAt ?? null
  ]);
  return JSON.stringify([
    room.code,
    room.status,
    room.hostId,
    room.currentTurn,
    room.currentQIndex,
    room.turnStartedAt,
    room.roundCount,
    room.winnerId ?? null,
    players
  ]);
}

function renderLobby() {
  el<HTMLDivElement>("lobby-code-val").textContent = GS.code;
  const list = el<HTMLDivElement>("players-list");
  const players = sortedPlayers(GS.players);
  list.innerHTML = players.map((p) => `
    <div class="player-row">
      <div class="mini-avatar">${avatarHtml(p.skinIndex)}</div>
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

function bombScale(): number {
  return window.innerWidth < 600 ? 0.58 : 0.66;
}

function bombTransform(point: BombPoint, scale = bombScale()): string {
  return `translate(calc(-50% + ${point.x.toFixed(1)}px), calc(-50% + ${point.y.toFixed(1)}px)) scale(${scale.toFixed(2)})`;
}

function handBombPoint(x: number, y: number, isMobile: boolean): BombPoint {
  const distance = Math.max(1, Math.hypot(x, y));
  const inwardX = -x / distance;
  const inwardY = -y / distance;
  const tangentX = -inwardY;
  const tangentY = inwardX;
  const side = x >= 0 ? 1 : -1;
  const inwardOffset = isMobile ? 10 : 16;
  const sideOffset = isMobile ? 34 : 52;
  const lowerOffset = isMobile ? -2 : -4;
  return {
    x: x + inwardX * inwardOffset + tangentX * side * sideOffset,
    y: y + inwardY * inwardOffset + tangentY * side * sideOffset + lowerOffset
  };
}

function playerVisualState(
  player: Player,
  isTurn: boolean,
  isThrowingFrom: boolean,
  isCatchingTo: boolean,
  lostLife: boolean
): PlayerVisualState {
  if (GS.status === "finished" && GS.winnerId === player.id) return "victory";
  if (player.lives <= 0) return "defeat";
  if (lostLife) return "hit";
  if (isThrowingFrom) return "throwingBomb";
  if (isCatchingTo) return "catchingBomb";
  if (isTurn) return "holdingBomb";
  return "idle";
}

function renderLives(lives: number): string {
  return [0, 1, 2].map((idx) => (
    `<span class="life-heart ${idx < lives ? "filled" : "empty"}" aria-hidden="true">&hearts;</span>`
  )).join("");
}

function triggerScreenImpact(kind: "boom" | "hit" = "hit") {
  const game = document.getElementById("scr-game");
  if (!game || prefersReducedMotion.matches) return;
  game.classList.remove("screen-impact", "screen-impact-boom");
  void game.offsetWidth;
  game.classList.add(kind === "boom" ? "screen-impact-boom" : "screen-impact");
  window.setTimeout(() => game.classList.remove("screen-impact", "screen-impact-boom"), kind === "boom" ? 620 : 360);
}

function spawnExplosionFx() {
  const circle = document.getElementById("players-circle");
  const bomb = document.getElementById("bomb-el");
  if (!circle || !bomb || prefersReducedMotion.matches) return;
  const circleRect = circle.getBoundingClientRect();
  const bombRect = bomb.getBoundingClientRect();
  const x = bombRect.left + bombRect.width / 2 - circleRect.left;
  const y = bombRect.top + bombRect.height / 2 - circleRect.top;
  const burst = document.createElement("div");
  burst.className = "explosion-burst";
  burst.style.left = `${x.toFixed(1)}px`;
  burst.style.top = `${y.toFixed(1)}px`;
  for (let i = 0; i < 16; i++) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * i) / 16;
    const distance = 28 + (i % 4) * 12;
    spark.style.setProperty("--ex", `${(Math.cos(angle) * distance).toFixed(1)}px`);
    spark.style.setProperty("--ey", `${(Math.sin(angle) * distance).toFixed(1)}px`);
    spark.style.setProperty("--ed", `${(i % 5) * 0.025}s`);
    burst.appendChild(spark);
  }
  circle.appendChild(burst);
  window.setTimeout(() => burst.remove(), 900);
}

function animateBombPass(bomb: HTMLElement, from: BombPoint, to: BombPoint) {
  const targetTransform = bombTransform(to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (prefersReducedMotion.matches || distance < 4) {
    bomb.classList.remove("bomb-throwing", "pass-pop");
    bomb.style.transition = "";
    bomb.style.transform = targetTransform;
    return;
  }

  bomb.style.setProperty("--throw-distance", `${distance.toFixed(1)}px`);
  bomb.style.setProperty("--throw-angle", `${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg`);
  bomb.style.setProperty("--throw-arc", `${Math.min(92, Math.max(36, distance * 0.24)).toFixed(1)}px`);
  bomb.style.setProperty("--throw-time", `${BOMB_PASS_MS}ms`);

  activeBombPass?.cancel();
  activeBombPass = null;
  bomb.classList.remove("bomb-throwing", "pass-pop");
  bomb.style.transition = "none";
  bomb.style.transform = bombTransform(from);
  void bomb.offsetWidth;

  const arc = Math.min(112, Math.max(42, distance * 0.28));
  const recoil = { x: from.x - dx * 0.08, y: from.y - dy * 0.08 - arc * 0.1 };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - arc };
  const settle = { x: to.x + dx * 0.035, y: to.y + dy * 0.035 + arc * 0.05 };

  bomb.classList.add("bomb-throwing", "pass-pop");
  if (typeof bomb.animate !== "function") {
    window.requestAnimationFrame(() => {
      bomb.style.transition = `transform ${BOMB_PASS_MS}ms cubic-bezier(.16,.92,.18,1)`;
      bomb.style.transform = targetTransform;
    });
    window.setTimeout(() => {
      bomb.classList.remove("bomb-throwing", "pass-pop");
      bomb.style.transition = "";
      bomb.style.transform = targetTransform;
    }, BOMB_PASS_MS + 90);
    return;
  }

  const passAnimation = bomb.animate(
    [
      { transform: bombTransform(from), offset: 0, easing: "cubic-bezier(.3,0,.55,1)" },
      { transform: bombTransform(recoil), offset: 0.14, easing: "cubic-bezier(.1,.8,.2,1)" },
      { transform: bombTransform(mid), offset: 0.52, easing: "cubic-bezier(.18,.9,.18,1)" },
      { transform: bombTransform(settle), offset: 0.86, easing: "cubic-bezier(.14,.9,.22,1)" },
      { transform: targetTransform, offset: 1 }
    ],
    { duration: BOMB_PASS_MS, easing: "linear", fill: "both" }
  );
  activeBombPass = passAnimation;

  const finishPass = () => {
    if (activeBombPass !== passAnimation) return;
    bomb.classList.remove("bomb-throwing", "pass-pop");
    bomb.style.transition = "";
    bomb.style.transform = targetTransform;
    if (activeBombPass === passAnimation) passAnimation.cancel();
    activeBombPass = null;
  };

  passAnimation.onfinish = finishPass;
  window.setTimeout(finishPass, BOMB_PASS_MS + 90);
}

function setBombFuseProgress(ratio: number) {
  const bomb = document.getElementById("bomb-el");
  if (!bomb) return;
  const visibleRatio = Math.max(0, Math.min(1, ratio));
  const burned = 1 - visibleRatio;
  bomb.style.setProperty("--fuse-visible", `${Math.max(4, 48 * visibleRatio).toFixed(1)}px`);
  bomb.style.setProperty("--spark-x", `${(-18 * burned).toFixed(1)}px`);
  bomb.style.setProperty("--spark-y", `${(13 * burned).toFixed(1)}px`);
  bomb.style.setProperty("--spark-scale", `${(1 + burned * 0.42).toFixed(2)}`);
}

function renderGame() {
  const circle = el<HTMLDivElement>("players-circle");
  const bomb = el<HTMLDivElement>("bomb-el");
  const players = sortedPlayers(GS.players);
  const count = players.length;
  const isMobile = window.innerWidth < 600;
  const circleSize = isMobile
    ? Math.min(Math.max(window.innerWidth * 0.78, 260), 310)
    : window.innerWidth >= 1024
      ? 560
      : 420;
  const radius = isMobile
    ? (count >= 5 ? circleSize * 0.385 : circleSize * 0.39)
    : (count >= 5 ? circleSize * 0.38 : circleSize * 0.34);
  const arrow = el<HTMLDivElement>("turn-arrow");
  const isMyTurn = GS.currentTurn === ME.id && GS.status === "playing";
  const previousTurnId = prevTurnId;
  const turnChanged = previousTurnId !== GS.currentTurn;
  const bombPoints = new Map<string, BombPoint>();
  const layout = players.map((p, i) => {
    const angle = (360 / count) * i - 90;
    const x = Math.cos((angle * Math.PI) / 180) * radius;
    const y = Math.sin((angle * Math.PI) / 180) * radius;
    return { p, angle, x, y };
  });
  const activeLayout = layout.find((item) => item.p.id === GS.currentTurn);
  const previousLayout = layout.find((item) => item.p.id === previousTurnId);
  let targetBombPoint: BombPoint = { x: 0, y: 0 };
  
  circle.querySelectorAll(".p-slot").forEach(s => s.remove());
  arrow.style.display = "none";
  el<HTMLSpanElement>("round-val").textContent = String(GS.roundCount || 1);
  el<HTMLDivElement>("scr-game").classList.toggle("no-question", !isMyTurn);

  layout.forEach(({ p, angle, x, y }, i) => {
    const bombPoint = handBombPoint(x, y, isMobile);
    const isTurn = p.id === GS.currentTurn;
    const isEliminated = p.lives <= 0;
    const isHost = p.id === GS.hostId;
    const isThrowingFrom = turnChanged && previousTurnId === p.id && !isTurn && !isEliminated;
    const isCatchingTo = turnChanged && Boolean(previousTurnId) && isTurn && !isEliminated;
    const previousLife = previousLives.get(p.id);
    const lostLife = previousLife !== undefined && p.lives < previousLife;
    const visualState = playerVisualState(p, isTurn, isThrowingFrom, isCatchingTo, lostLife);
    const handTarget = isThrowingFrom && activeLayout
      ? { x: activeLayout.x, y: activeLayout.y }
      : isCatchingTo && previousLayout
        ? { x: previousLayout.x, y: previousLayout.y }
        : { x: 0, y: 0 };
    const aimDx = handTarget.x - x;
    const aimDy = handTarget.y - y;
    const aimDistance = Math.max(1, Math.hypot(aimDx, aimDy));
    const aimAngle = Math.atan2(aimDy, aimDx) * 180 / Math.PI;
    const lookTarget = isThrowingFrom && activeLayout
      ? { x: activeLayout.x, y: activeLayout.y }
      : isCatchingTo && previousLayout
        ? { x: previousLayout.x, y: previousLayout.y }
        : activeLayout && activeLayout.p.id !== p.id
          ? { x: activeLayout.x, y: activeLayout.y }
          : { x: 0, y: 0 };
    const lookDx = lookTarget.x - x;
    const lookDy = lookTarget.y - y;
    const lookDistance = Math.max(1, Math.hypot(lookDx, lookDy));
    const lookX = Math.max(-18, Math.min(18, (-lookDy / lookDistance) * 15));
    const lookY = Math.max(-22, Math.min(22, (lookDx / lookDistance) * 18));
    const lookRoll = Math.max(-7, Math.min(7, (lookDx / lookDistance) * -6));
    const faceShiftX = Math.max(-5, Math.min(5, (lookDx / lookDistance) * 4));
    const faceShiftY = Math.max(-5, Math.min(5, (lookDy / lookDistance) * 3));
    const hopX = Math.cos((aimAngle * Math.PI) / 180) * (isMobile ? 8 : 10);
    const hopY = Math.sin((aimAngle * Math.PI) / 180) * (isMobile ? 8 : 10) - (isMobile ? 8 : 12);
    const palette = AVATAR_BODY_PALETTES[skinIndexOf(p.skinIndex) % AVATAR_BODY_PALETTES.length];
    const bodySrc = bodyImageSrc(p.skinIndex);
    const bodyFacesLeft = skinIndexOf(p.skinIndex) !== 0;
    const bodyFaceScale = bodyFacesLeft && lookDx > 0 ? -1 : 1;
    const slotColor = SLOT_COLORS[i % SLOT_COLORS.length];

    bombPoints.set(p.id, bombPoint);

    const slot = document.createElement("div");
    slot.className = `p-slot state-${visualState} ${isTurn ? "active-turn" : ""} ${isEliminated ? "eliminated" : ""} ${isThrowingFrom ? "throwing-from" : ""} ${isCatchingTo ? "catching-to" : ""}`;
    slot.style.setProperty("--slot-x", `${x.toFixed(1)}px`);
    slot.style.setProperty("--slot-y", `${y.toFixed(1)}px`);
    slot.style.setProperty("--slot-hop-x", `${hopX.toFixed(1)}px`);
    slot.style.setProperty("--slot-hop-y", `${hopY.toFixed(1)}px`);
    slot.style.transform = "translate(var(--slot-x), var(--slot-y))";
    slot.style.setProperty("--aim-angle", `${aimAngle.toFixed(1)}deg`);
    slot.style.setProperty("--hands-rotate", `${(aimAngle + 90).toFixed(1)}deg`);
    slot.style.setProperty("--look-x", `${lookX.toFixed(1)}deg`);
    slot.style.setProperty("--look-y", `${lookY.toFixed(1)}deg`);
    slot.style.setProperty("--look-roll", `${lookRoll.toFixed(1)}deg`);
    slot.style.setProperty("--face-shift-x", `${faceShiftX.toFixed(1)}px`);
    slot.style.setProperty("--face-shift-y", `${faceShiftY.toFixed(1)}px`);
    slot.style.setProperty("--aim-distance", `${aimDistance.toFixed(1)}px`);
    slot.style.setProperty("--avatar-shirt", palette.shirt);
    slot.style.setProperty("--avatar-shirt-2", palette.shirt2);
    slot.style.setProperty("--avatar-pants", palette.pants);
    slot.style.setProperty("--avatar-shoe", palette.shoe);
    slot.style.setProperty("--avatar-skin", palette.skin);
    slot.style.setProperty("--body-face-scale", String(bodyFaceScale));
    slot.style.setProperty("--body-filter", BODY_IMAGE_FILTERS[skinIndexOf(p.skinIndex)] ?? "none");
    slot.style.setProperty("--slot-color", slotColor);
    slot.dataset.playerId = p.id;
    slot.dataset.state = visualState;
    
    slot.innerHTML = `
      <div class="p-avatar-wrap ${bodySrc ? "has-body-art" : ""}">
        ${isHost ? '<div class="p-crown">HOST</div>' : ''}
        <span class="avatar-ground" aria-hidden="true"></span>
        ${bodySrc ? `<span class="avatar-photo-stage" aria-hidden="true"><img class="avatar-body-art" src="${esc(bodySrc)}" alt="" draggable="false"></span>` : ""}
        <span class="avatar-body" aria-hidden="true">
          <span class="avatar-neck"></span>
          <span class="avatar-torso"></span>
          <span class="avatar-arm avatar-arm-a"></span>
          <span class="avatar-arm avatar-arm-b"></span>
          <span class="avatar-leg avatar-leg-a"></span>
          <span class="avatar-leg avatar-leg-b"></span>
          <span class="avatar-shoe avatar-shoe-a"></span>
          <span class="avatar-shoe avatar-shoe-b"></span>
        </span>
        <span class="throw-arm throw-arm-a" aria-hidden="true"></span>
        <span class="throw-arm throw-arm-b" aria-hidden="true"></span>
        <span class="hold-hands" aria-hidden="true"></span>
        ${avatarHtml(p.skinIndex)}
      </div>
      <div class="p-name">${esc(p.nick)}</div>
      <div class="p-lives" aria-label="${p.lives} vidas">${renderLives(p.lives)}</div>
    `;
    circle.appendChild(slot);
    
    if (isTurn) {
      arrow.style.display = "block";
      arrow.style.transform = `rotate(${angle + 90}deg)`;
      targetBombPoint = bombPoint;
    }
  });

  const visiblePlayerIds = new Set(players.map((p) => p.id));
  players.forEach((p) => previousLives.set(p.id, p.lives));
  Array.from(previousLives.keys()).forEach((id) => {
    if (!visiblePlayerIds.has(id)) previousLives.delete(id);
  });

  if (turnChanged) {
    const fromPoint = previousTurnId ? bombPoints.get(previousTurnId) : undefined;
    if (previousTurnId && GS.currentTurn && fromPoint) {
      const turnAfterPass = GS.currentTurn;
      animateBombPass(bomb, fromPoint, targetBombPoint);
      window.setTimeout(() => {
        circle.querySelectorAll(".throwing-from,.catching-to").forEach((slot) => {
          slot.classList.remove("throwing-from", "catching-to");
        });
        circle.querySelectorAll<HTMLElement>(".state-throwingBomb,.state-catchingBomb").forEach((slot) => {
          const nextState = slot.dataset.playerId === turnAfterPass ? "holdingBomb" : "idle";
          slot.classList.remove("state-throwingBomb", "state-catchingBomb", "state-idle", "state-holdingBomb");
          slot.classList.add(`state-${nextState}`);
          slot.dataset.state = nextState;
        });
      }, BOMB_PASS_MS + 140);
    } else {
      bomb.classList.remove("bomb-throwing", "pass-pop");
      bomb.style.transition = "";
      bomb.style.transform = bombTransform(targetBombPoint);
    }
    prevTurnId = GS.currentTurn;
  } else {
    bomb.style.transform = bombTransform(targetBombPoint);
  }

  if (isMyTurn) {
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
    btn.className = "op-btn";
    btn.textContent = o;
    btn.onclick = () => void submitAnswer(o);
    ops.appendChild(btn);
  });
  
  startTimer();
}

function startTimer() {
  stopTimer();
  setBombFuseProgress(1);
  updateTimer();
  bombTimerInterval = setInterval(updateTimer, 100);
}

function stopTimer() {
  if (bombTimerInterval) clearInterval(bombTimerInterval);
  bombTimerInterval = null;
  lastTickSecond = null;
  const bomb = document.getElementById("bomb-el");
  bomb?.classList.remove("warning", "danger");
  setBombFuseProgress(1);
  document.getElementById("bomb-timer")?.classList.remove("danger");
  document.querySelectorAll(".p-avatar-wrap").forEach((av) => av.classList.remove("panic"));
}

function updateTimer() {
  if (GS.status !== "playing") { stopTimer(); return; }
  
  const baseDuration = Math.max(3, 10.5 - ((GS.roundCount || 1) * 0.5));
  const elapsed = (now() - GS.turnStartedAt) / 1000;
  const remaining = Math.max(0, Math.ceil(baseDuration - elapsed));
  const fuseRatio = Math.max(0, Math.min(1, (baseDuration - elapsed) / baseDuration));
  
  const timer = el<HTMLDivElement>("bomb-timer");
  timer.textContent = String(remaining).padStart(2, "0");
  const isDanger = remaining <= 3 && remaining > 0;
  const isWarning = remaining <= 5 && remaining > 3;
  timer.classList.toggle("danger", isDanger);
  const bomb = el<HTMLDivElement>("bomb-el");
  bomb.classList.toggle("danger", isDanger);
  bomb.classList.toggle("warning", isWarning);
  setBombFuseProgress(fuseRatio);
  
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
  triggerScreenImpact("boom");
  spawnExplosionFx();
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
  else {
    playBoom();
    triggerScreenImpact("hit");
    spawnExplosionFx();
  }

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
  const slot =
    document.querySelector<HTMLElement>(`.p-slot[data-player-id="${attrEsc(playerId)}"]`) ??
    el<HTMLDivElement>("emoji-menu");
  const safeEmoji = normalizeReactionEmoji(emoji);
  const pop = document.createElement("div");
  pop.className = "reaction-pop";
  pop.textContent = safeEmoji;
  pop.setAttribute("aria-hidden", "true");
  slot.appendChild(pop);

  const avatar = slot.querySelector<HTMLElement>(".p-avatar-wrap");
  if (avatar) {
    avatar.classList.remove("reaction-hit");
    void avatar.offsetWidth;
    avatar.classList.add("reaction-hit");
    window.setTimeout(() => avatar.classList.remove("reaction-hit"), 460);
  }

  const burst = document.createElement("div");
  burst.className = "reaction-burst";
  burst.setAttribute("aria-hidden", "true");
  const sparkCount = 10;
  for (let i = 0; i < sparkCount; i++) {
    const spark = document.createElement("span");
    spark.className = "reaction-spark";
    spark.textContent = REACTION_SPARKS[i % REACTION_SPARKS.length];
    const angle = -112 + (224 / (sparkCount - 1)) * i;
    const dist = 34 + (i % 3) * 12;
    const tx = Math.cos((angle * Math.PI) / 180) * dist;
    const ty = Math.sin((angle * Math.PI) / 180) * dist - 16;
    spark.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    spark.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    spark.style.setProperty("--rot", `${Math.round(angle * 1.6)}deg`);
    spark.style.setProperty("--del", `${(i % 4) * 0.035}s`);
    burst.appendChild(spark);
  }
  slot.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1250);

  setTimeout(() => pop.remove(), 2000);
}

function getReactionPlayerId(): string {
  if (ME.id) return ME.id;
  const nickMatch = sortedPlayers(GS.players).find((p) => p.online && p.nick === ME.nick);
  const visiblePlayer =
    document.querySelector<HTMLElement>(".p-slot:not(.eliminated)")?.dataset.playerId ??
    document.querySelector<HTMLElement>(".p-slot")?.dataset.playerId;
  return nickMatch?.id ?? GS.currentTurn ?? sortedPlayers(GS.players)[0]?.id ?? visiblePlayer ?? "";
}

async function sendReaction(emoji: string) {
  const reactionPlayerId = getReactionPlayerId();
  const localId = uid();
  sentReactionIds.add(localId);
  showReaction(reactionPlayerId, emoji);
  if (!reactionPlayerId) {
    sentReactionIds.delete(localId);
    return;
  }
  if (localMode || !reactionRef) {
    sentReactionIds.delete(localId);
    return;
  }
  try {
    await reactionRef.push({ playerId: reactionPlayerId, emoji, at: now(), localId });
  } catch {
    sentReactionIds.delete(localId);
  }
}

async function copiarCodigo() {
  const code = ME.salaId || GS.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast("Codigo copiado."); }
  catch { toast(code); }
}

function cleanupRoom(updateRemote = true) {
  stopTimer();
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  if (salaRef) {
    salaRef.off();
    if (updateRemote && ME.id) salaRef.child(`players/${ME.id}`).update({ online: false });
  }
  salaRef = null;
  reactionRef = null;
  lastRoomSignature = "";
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
      const remaining = sortedPlayers(room.players).filter((p) => p.id !== ME.id && isFreshPlayer(p));
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

function reactFromButton(btn: HTMLElement, ev: Event) {
  ev.preventDefault();
  const last = Number(btn.dataset.lastReactionAt || 0);
  if (now() - last < 350) return;
  btn.dataset.lastReactionAt = String(now());
  void sendReaction(btn.dataset.emoji ?? DEFAULT_REACTION);
}

function bindReactionButtons() {
  document.querySelectorAll<HTMLElement>(".emoji-btn").forEach((btn) => {
    const react = (ev: Event) => reactFromButton(btn, ev);
    btn.onpointerdown = react;
    btn.onclick = react;
    btn.ontouchend = react;
  });
}

function bindReactionEvents() {
  if (reactionEventsBound) return;
  reactionEventsBound = true;
  const react = (ev: Event) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>(".emoji-btn");
    if (btn) reactFromButton(btn, ev);
  };
  document.addEventListener("pointerdown", react, true);
  document.addEventListener("click", react, true);
  document.addEventListener("touchend", react, { capture: true, passive: false });
  bindReactionButtons();
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
  bindReactionEvents();
}

window.addEventListener("DOMContentLoaded", () => {
  initFB();
  const saved = loadNick();
  if (saved) el<HTMLInputElement>("nick-input").value = saved;
  initTiles();
  bindReactionEvents();
  bindEvents();
});
