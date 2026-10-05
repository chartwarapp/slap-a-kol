/* =========================================================================
 * Slap-a-KOL — game controller (screens, fight state machine, economy UI).
 * -------------------------------------------------------------------------
 * Economy (points only for now): matches are FREE and pay PTS; optionally
 * bet PTS for a bigger payout; stake PTS in the Vault for yield + boost.
 * Upgrades / Golden Fist cost PTS. Wallet connect is a mock Solana
 * placeholder. Roster = built-in parody KOLs + user-submitted KOLs.
 *
 * Fight loop:
 *   PLAYER turn : meter swings → tap locks → slap anim → damage
 *   KOL turn    : AI winds up → (optional) brace tap → slap anim → damage
 *   … repeat until someone hits 0 HP → knockout fly-off → result screen
 * ========================================================================= */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const wait = s => new Promise(r => setTimeout(r, s * 1000));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const ptsHTML = cls => `<span class="pts ${cls || 'sm'}">★</span>`;
  const esc = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const S = SAK.Storage.load();      // persistent save
  const W = SAK.Wallet, A = SAK.Audio, P = SAK.Points, V = SAK.Vault;
  let Scene = null;                  // SAK.Scene3D once WebGL is up

  /* ----------------------------------------------------------- derived stats */
  const playerMaxHp = () => SAK.PLAYER.baseHp + S.upgrades.health * SAK.PLAYER.hpPerLevel;
  const playerPower = () => SAK.PLAYER.basePower + S.upgrades.power * SAK.PLAYER.powerPerLevel;
  const upgradeCost = type => {
    const u = SAK.UPGRADES[type];
    return Math.round(u.baseCost * Math.pow(u.growth, S.upgrades[type]) / 10) * 10;
  };
  const meterSpeed = kol => SAK.METER.baseSpeed + (kol.difficulty - 1) * SAK.METER.speedPerDifficulty;
  const boosted = n => Math.round(n * (1 + V.boost));

  /* ------------------------------------------------------- player fighter */
  const DEFAULT_PROFILE = { name: 'YOU', colour: '#2f80ff', phrase: 'gm. prepare to get slapped.' };
  const profile = () => S.profile || DEFAULT_PROFILE;
  /** Player's 3D/SVG look: chosen colour + face/hair hashed from the name. */
  function playerLook() {
    const p = profile(), L = lookFromName(p.name, p.colour), base = SAK.PLAYER.look;
    return { skin: S.profile ? L.skin : base.skin, hair: S.profile ? L.hair : base.hair, shirt: p.colour, pants: base.pants, accessory: 'headband', accent: '#ffffff' };
  }

  /* ------------------------------------------------------------ roster (UGC) */
  /** Turn a saved user submission into a full KOL object. */
  function hydrateCustom(c) {
    return Object.assign({
      id: c.id, name: c.name, handle: '@' + c.name.replace(/[^a-z0-9]/gi, '') + '_fanmade', level: 'FAN',
      tagline: c.phrase, custom: true,
      look: { skin: c.skin, shirt: c.shirt, hair: c.hair, pants: '#2a2a40', accessory: c.accessory, accent: c.accessory === 'laser' ? '#ff1a1a' : '#ffd23f' },
      taunts: [c.phrase, 'Fan-made and fully unhinged.', 'Community-submitted slap incoming!']
    }, SAK.customKolStats(Math.max(1, Math.min(5, c.difficulty || 2))));
  }
  const roster = () => SAK.KOLS.concat(S.customKols.map(hydrateCustom));
  const ugcSlotsUnlocked = () => SAK.UGC.slotMilestones.filter(m => S.stats.lifetimePts >= m).length;
  const ugcNextMilestone = () => SAK.UGC.slotMilestones.find(m => S.stats.lifetimePts < m);

  /* -------------------------------------------------------------- UI helpers */
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 1800);
  }
  function floatText(x, y, html, cls) {
    const el = document.createElement('div');
    el.className = 'float-text ' + (cls || '');
    el.innerHTML = html; el.style.left = x + 'px'; el.style.top = y + 'px';
    $('#fx-layer').appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }
  function flash(color) {
    const el = document.createElement('div');
    el.className = 'flash'; el.style.background = color;
    $('#fx-layer').appendChild(el); setTimeout(() => el.remove(), 300);
  }
  async function banner(text, color, ms) {
    const b = $('#banner'); b.textContent = text; b.style.color = color || '';
    b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    await wait((ms || 1000) / 1000); b.classList.add('hidden');
  }
  function haptic(ms) { if (S.settings.haptics && navigator.vibrate) navigator.vibrate(ms); }
  const appRect = () => $('#app').getBoundingClientRect();

  // Animated PTS counter
  let shownPts = S.points, ptsRaf = 0;
  function renderPoints() {
    const target = S.points, start = shownPts, t0 = performance.now();
    cancelAnimationFrame(ptsRaf);
    if (target !== start) { const p = $('#pts-pill'); p.classList.add('bump'); setTimeout(() => p.classList.remove('bump'), 160); }
    const step = now => {
      const k = Math.min(1, (now - t0) / 600);
      shownPts = start + (target - start) * (1 - Math.pow(1 - k, 3));
      $('#points').textContent = fmt(shownPts);
      if (k < 1) ptsRaf = requestAnimationFrame(step);
    };
    ptsRaf = requestAnimationFrame(step);
  }

  function renderMenu() {
    const on = W.isConnected;
    $('#fighter-chip-av').innerHTML = SAK.avatarSVG(playerLook());
    $('#fighter-chip-name').textContent = profile().name;
    $('#wallet-chip').classList.toggle('hidden', !on);
    $('#wallet-addr').textContent = W.shortAddress();
    $('#btn-connect').innerHTML = on
      ? `✅ ${W.shortAddress()}<small class="btn-sub">mock · Solana coming soon</small>`
      : '👛 CONNECT WALLET<small class="btn-sub">Solana · coming soon</small>';
    $('#btn-connect').classList.toggle('btn-purple', !on);
    $('#btn-connect').classList.toggle('btn-grey', on);
    $('#vault-sub').textContent = V.staked > 0 ? `${fmt(V.staked)} staked · ${V.tier.name}` : 'earn yield + boost';
    $('#btn-rescue').classList.toggle('hidden', !(S.points < SAK.POINTS.rescueThreshold && V.staked === 0));
    const st = S.stats;
    $('#menu-stats').innerHTML = `<span>🏆 ${st.wins}W / ${st.losses}L</span><span>🔥 Streak ${st.streak}</span><span>❤ Lv${S.upgrades.health} ✊ Lv${S.upgrades.power}</span>`
      + (V.boost ? `<span class="boost-tag">⚡ +${Math.round(V.boost * 100)}% boost</span>` : '');
    $('#set-wallet').textContent = on ? `Mock address: ${W.address}` : 'Wallet not connected (placeholder)';
    $('#btn-disconnect').classList.toggle('hidden', !on);
  }

  /* ----------------------------------------------------------------- screens */
  let screen = 'menu';
  function show(name) {
    screen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    if (Scene) Scene.setMode(name === 'result' ? 'fight' : name);
    if (name === 'menu') renderMenu();
  }

  /* --------------------------------------------------------- daily / bonuses */
  function grantDailyFist() {
    if (S.lastFreeFistDate !== todayStr()) {
      S.lastFreeFistDate = todayStr();
      const PU = SAK.POWERUPS.fist;
      S.powerups.fist = Math.min(PU.max, (S.powerups.fist || 0) + PU.freePerDay);
      SAK.Storage.save();
    }
  }

  /* ================================================================== MENU */
  function openWalletModal() { A.unlock(); A.click(); $('#modal-wallet').classList.remove('hidden'); }

  $('#btn-connect').addEventListener('click', () => {
    if (W.isConnected) { toast(`Connected ${W.shortAddress()} (mock placeholder)`); return; }
    openWalletModal();
  });
  $('#wallet-cancel').addEventListener('click', () => $('#modal-wallet').classList.add('hidden'));
  $('#wallet-approve').addEventListener('click', async () => {
    const btn = $('#wallet-approve'); btn.disabled = true; btn.textContent = 'Connecting…';
    await W.connect();
    btn.disabled = false; btn.textContent = 'Connect';
    $('#modal-wallet').classList.add('hidden');
    A.coin();
    toast(`Wallet ${W.shortAddress()} linked (mock) — on-chain rewards coming later`, 2600);
    renderMenu();
  });

  $('#btn-play').addEventListener('click', () => {
    A.unlock(); A.click();
    if (!S.profile) return openFighter(true);   // first run: create your fighter, then play
    openPicker();
  });
  $('#btn-fighter').addEventListener('click', () => { A.unlock(); A.click(); openFighter(false); });

  /* --- create / edit my fighter (name, colour, catchphrase) -------------- */
  let fighterDraft = null, playAfterFighter = false;
  function openFighter(thenPlay) {
    playAfterFighter = !!thenPlay;
    const p = profile();
    fighterDraft = { colour: p.colour };
    $('#fit-name').value = S.profile ? p.name : '';
    $('#fit-phrase').value = S.profile ? p.phrase : '';
    $('#fit-colours').innerHTML = SAK.UGC.palettes.shirt.concat(['#39ff88', '#ffffff']).map(c => `<button type="button" data-c="${c}" style="background:${c}"></button>`).join('');
    $$('#fit-colours button').forEach(b => b.onclick = () => { fighterDraft.colour = b.dataset.c; renderFighterDraft(); });
    $('#fit-name').oninput = renderFighterDraft;
    renderFighterDraft();
    $('#modal-fighter').classList.remove('hidden');
  }
  function renderFighterDraft() {
    const name = $('#fit-name').value.trim() || 'YOU', L = lookFromName(name, fighterDraft.colour);
    $('#fit-preview').innerHTML = SAK.avatarSVG({ skin: L.skin, hair: L.hair, shirt: fighterDraft.colour, accessory: 'headband' });
    $$('#fit-colours button').forEach(b => b.classList.toggle('on', b.dataset.c === fighterDraft.colour));
  }
  $('#fighter-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = validateText($('#fit-name').value, SAK.UGC.maxName);
    const ph = validateText($('#fit-phrase').value || DEFAULT_PROFILE.phrase, SAK.UGC.maxCatchphrase);
    if (n.err) return toast('Name: ' + n.err);
    if (ph.err) return toast('Catchphrase: ' + ph.err);
    S.profile = { name: n.ok, colour: fighterDraft.colour, phrase: ph.ok };
    SAK.Storage.save();
    if (Scene) Scene.setPlayer(playerLook());
    $('#modal-fighter').classList.add('hidden');
    A.perfect(); toast(`${n.ok} has entered the arena. LFG 🚀`);
    renderMenu();
    if (playAfterFighter) openPicker();
  });
  // "Later" on first run still lets you play as the default fighter
  $('#modal-fighter [data-close]').addEventListener('click', () => { if (playAfterFighter) setTimeout(openPicker, 50); });
  $('#btn-vault').addEventListener('click', () => { A.unlock(); A.click(); openVault(); });
  $('#btn-rescue').addEventListener('click', () => {
    if (S.points >= SAK.POINTS.rescueThreshold) return;
    P.add(SAK.POINTS.rescueAmount, false);
    A.coin(); toast(`🛟 +${fmt(SAK.POINTS.rescueAmount)} PTS — get back in there!`);
    renderMenu();
  });
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => { A.click(); show(b.dataset.nav); }));

  /* ================================================================ PICKER */
  let selected = 0;
  let selectedBet = 0;   // PTS bet for the next fight (0 = free match)
  let selectedMode = 'classic';   // 'classic' (KO) | 'duel' (one slap each)

  /** Render the CLASSIC KO / QUICK DUEL toggle into `el`. */
  function renderModes(el, mode, onPick) {
    el.innerHTML = Object.values(SAK.MODES).map(m => `
      <button type="button" class="mode-btn ${m.id} ${m.id === mode ? 'selected' : ''}" data-mode="${m.id}">
        <b>${m.icon} ${m.label}</b><small>${m.desc}</small></button>`).join('');
    el.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => { A.click(); onPick(b.dataset.mode); });
  }
  const modePts = (k, mode) => boosted(k.winPts * SAK.MODES[mode].ptsMult);

  function openPicker(forceIdx) {
    const list = roster();
    const idx = list.findIndex(k => !S.beaten[k.id]);   // default: first unbeaten
    selected = forceIdx !== undefined ? forceIdx : idx >= 0 ? idx : 0;
    selected = Math.min(selected, list.length - 1);
    renderPicker();
    show('pick');
    selectKol(selected, true);
  }

  function renderPicker() {
    const list = roster();
    const used = S.customKols.length, slots = ugcSlotsUnlocked(), next = ugcNextMilestone();
    const canSubmit = used < slots;
    $('#kol-list').innerHTML = list.map((k, i) => `
      <button class="kol-card ${i === selected ? 'selected' : ''}" data-i="${i}">
        ${S.beaten[k.id] ? '<span class="beaten">✓</span>' : ''}
        ${k.custom ? '<span class="fan">FAN</span>' : ''}
        ${SAK.avatarSVG(k.look)}
        <div class="kc-name">${esc(k.name)}</div>
        <div class="kc-stake">${ptsHTML()}+${fmt(k.winPts)}</div>
      </button>`).join('') + `
      <button class="kol-card submit-card-btn ${canSubmit ? '' : 'locked'}" id="btn-submit-kol">
        <span class="plus">${canSubmit ? '+' : '🔒'}</span>
        <div class="kc-name">SUBMIT KOL</div>
        <small>${canSubmit ? `${slots - used} slot${slots - used > 1 ? 's' : ''} free` : next !== undefined ? `next slot at ${fmt(next)} lifetime PTS` : 'all slots used'}</small>
      </button>`;
    $$('.kol-card[data-i]').forEach(c => c.addEventListener('click', () => { A.click(); selectKol(+c.dataset.i); }));
    $('#btn-submit-kol').addEventListener('click', () => { A.click(); openSubmit(); });
  }

  function selectKol(i, noTaunt) {
    const list = roster();
    selected = i;
    const k = list[i];
    $$('.kol-card[data-i]').forEach(c => c.classList.toggle('selected', +c.dataset.i === i));
    const maxHp = 260, maxPow = 28;
    $('#kol-detail').innerHTML = `
      <div><div class="kd-name">${esc(k.name)}</div><div class="kd-handle">${esc(k.handle)} · ${k.custom ? 'FAN-MADE' : 'LEVEL ' + k.level}</div></div>
      <div class="kd-stars">${'★'.repeat(Math.max(0, Math.min(5, k.difficulty)))}<span style="opacity:.3">${'★'.repeat(Math.max(0, 5 - k.difficulty))}</span></div>
      <div class="kd-tag">“${esc(k.tagline)}”</div>
      <div class="kd-stats">
        <span>❤ HP</span><div class="stat-bar"><i style="width:${k.hp / maxHp * 100}%;background:#2ee66b"></i></div><span>${k.hp}</span>
        <span>✊ POWER</span><div class="stat-bar"><i style="width:${k.power / maxPow * 100}%;background:#ff3b5c"></i></div><span>${k.power}</span>
      </div>
      <div class="kd-money">
        <div>WIN ${ptsHTML()}<b>+${fmt(modePts(k, selectedMode))}</b></div>
        <div>BET PAYS <b style="color:#2ee66b">x${k.payout.toFixed(1)}</b>${V.boost ? ` <span class="boost-tag">+${Math.round(V.boost * 100)}%</span>` : ''}</div>
      </div>
      ${k.custom ? `<button class="kd-remove" id="btn-remove-kol">🗑 Remove fan KOL</button>` : ''}`;
    if ($('#btn-remove-kol')) $('#btn-remove-kol').addEventListener('click', () => removeCustom(k.id));
    if (selectedBet && selectedBet < k.minBet) selectedBet = 0;
    renderModes($('#mode-row'), selectedMode, m => { selectedMode = m; selectKol(selected, true); });
    renderBets();
    if (Scene) { Scene.setOpponent(k.look); if (!noTaunt) Scene.taunt(); }
    const card = $(`.kol-card[data-i="${i}"]`); if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function renderBets() {
    const k = roster()[selected];
    if (selectedBet && !P.canAfford(selectedBet)) selectedBet = 0;
    $('#bet-chips').innerHTML = SAK.BETS.map(b => {
      const free = b === 0, locked = !free && (b < k.minBet || !P.canAfford(b));
      return `<button class="bet-chip ${free ? 'free' : ''} ${b === selectedBet ? 'selected' : ''} ${locked ? 'locked' : ''}" data-bet="${b}">
        ${free ? 'FREE' : `${ptsHTML()}${b >= 1000 ? b / 1000 + 'K' : b}`}</button>`;
    }).join('');
    $('#bet-hint').textContent = selectedBet
      ? `win → ${fmt(boosted(selectedBet * k.payout))} PTS`
      : `min bet ${fmt(k.minBet)} PTS`;
    $$('.bet-chip').forEach(c => c.addEventListener('click', () => {
      const b = +c.dataset.bet; A.click();
      if (b && b < k.minBet) return toast(`${k.name} min bet: ${fmt(k.minBet)} PTS`);
      if (b && !P.canAfford(b)) return toast('Not enough PTS for that bet');
      selectedBet = b; renderBets();
    }));
    const btn = $('#btn-challenge');
    btn.className = 'btn btn-xl ' + (selectedBet ? 'btn-red' : 'btn-yellow');
    btn.innerHTML = selectedBet ? `🖐 SEND IT · BET ${fmt(selectedBet)} PTS` : `🖐 SEND IT · FREE · +${fmt(modePts(k, selectedMode))} PTS`;
  }

  $('#btn-challenge').addEventListener('click', () => startFight(roster()[selected], selectedBet, { mode: selectedMode }));

  /* ======================================================= SUBMIT A KOL (UGC) */
  let draft = null;
  /** Deterministic look/stats from the name, so the form stays tiny (name, colour, catchphrase). */
  function lookFromName(name, colour) {
    let h = 0; for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const P = SAK.UGC.palettes, A = SAK.UGC.accessories;
    return {
      skin: P.skin[h % P.skin.length], hair: P.hair[(h >>> 3) % P.hair.length], shirt: colour,
      accessory: A[(h >>> 6) % A.length], difficulty: 1 + ((h >>> 9) % 4)
    };
  }
  function openSubmit() {
    const used = S.customKols.length, slots = ugcSlotsUnlocked(), next = ugcNextMilestone();
    if (used >= slots) {
      return toast(next !== undefined ? `Slots full. Earn ${fmt(next - S.stats.lifetimePts)} more PTS to unlock another` : 'All submission slots used');
    }
    const pal = SAK.UGC.palettes;
    draft = { shirt: pick(pal.shirt) };
    $('#sub-name').value = ''; $('#sub-phrase').value = '';
    const box = $('.swatches[data-key="shirt"]');
    box.innerHTML = pal.shirt.map(c => `<button type="button" data-c="${c}" style="background:${c}"></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => { draft.shirt = b.dataset.c; renderDraft(); });
    $('#sub-name').oninput = renderDraft;
    $('#sub-slots').textContent = `Slots used ${used}/${slots}` + (next !== undefined ? ` · next slot at ${fmt(next)} lifetime PTS (you: ${fmt(S.stats.lifetimePts)})` : '');
    renderDraft();
    $('#modal-submit').classList.remove('hidden');
  }
  function renderDraft() {
    const name = $('#sub-name').value.trim() || 'Anon';
    const L = lookFromName(name, draft.shirt), st = SAK.customKolStats(L.difficulty);
    const look = { skin: L.skin, shirt: L.shirt, hair: L.hair, accessory: L.accessory, accent: L.accessory === 'laser' ? '#ff1a1a' : '#ffd23f' };
    $('#sub-preview').innerHTML = SAK.avatarSVG(look) + `<div class="sub-stats">${'★'.repeat(L.difficulty)} ❤${st.hp} ✊${st.power}</div>`;
    $$('.swatches[data-key="shirt"] button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.shirt));
  }
  function validateText(str, max) {
    const t = str.replace(/\s+/g, ' ').trim();
    if (!t) return { err: 'required' };
    if (t.length > max) return { err: `max ${max} characters` };
    const low = t.toLowerCase();
    if (SAK.UGC.blocklist.some(w => low.includes(w))) return { err: 'keep it playful 🙏' };
    if (/https?:|www\.|@\w{2,}/i.test(t)) return { err: 'no links or @handles' };
    return { ok: t };
  }
  $('#submit-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = validateText($('#sub-name').value, SAK.UGC.maxName);
    const ph = validateText($('#sub-phrase').value, SAK.UGC.maxCatchphrase);
    if (n.err) return toast('Name: ' + n.err);
    if (ph.err) return toast('Catchphrase: ' + ph.err);
    if (roster().some(k => k.name.toLowerCase() === n.ok.toLowerCase())) return toast('That name is taken');
    if (S.customKols.length >= ugcSlotsUnlocked()) return toast('No free slots');
    const entry = Object.assign(lookFromName(n.ok, draft.shirt), { id: 'ugc_' + Date.now().toString(36), name: n.ok, phrase: ph.ok, createdAt: Date.now() });
    S.customKols.push(entry);
    SAK.Storage.save();
    $('#modal-submit').classList.add('hidden');
    A.perfect(); toast(`🎉 ${entry.name} just got listed. Time to slap!`);
    const idx = roster().findIndex(k => k.id === entry.id);
    renderPicker(); selectKol(idx);
  });
  function removeCustom(id) {
    const k = S.customKols.find(c => c.id === id);
    if (!k || !confirm(`Remove ${k.name} from the roster? (frees the slot)`)) return;
    S.customKols = S.customKols.filter(c => c.id !== id);
    delete S.beaten[id];
    SAK.Storage.save();
    selected = 0; renderPicker(); selectKol(0, true);
  }

  /* ================================================================= FIGHT */
  let F = null;   // current fight state
  let lastSlots = 1;  // UGC slots unlocked (to announce new unlocks)

  function startFight(kol, bet, opts) {
    A.unlock();
    opts = opts || {};
    bet = bet || 0;
    const mode = opts.mode || 'classic';
    if (bet > 0) {   // optional bet is escrowed up-front
      if (bet < kol.minBet) bet = 0;
      else if (!P.spend(bet)) { toast('Not enough PTS for that bet'); return; }
      else A.coin();
    }
    grantDailyFist();
    F = {
      kol, bet, hits: 0,
      pMax: playerMaxHp(), pHp: playerMaxHp(),
      kMax: kol.hp, kHp: kol.hp,
      turn: 'intro', started: false,
      perfects: 0, maxHit: 0, slaps: 0,
      fireArmed: false,
      pu: { used: {}, helmet: 0, rage: 0 },   // power-up state for this fight
      brace: null,
      mode, duel: { p: null, k: null }, opts
    };
    $('#duel-score') && $('#duel-score').remove();
    if (Scene) { Scene.setOpponent(kol.look); Scene.resetFight(); }
    $('#p-portrait').innerHTML = SAK.avatarSVG(playerLook());
    $('#p-name').textContent = profile().name;
    $('#k-portrait').innerHTML = SAK.avatarSVG(kol.look);
    $('#k-name').textContent = kol.name;
    $('#fight-level').textContent = kol.pvp ? 'PVP · AI' : kol.custom ? 'FAN KOL' : 'LEVEL ' + kol.level;
    const M = SAK.MODES[mode];
    $('#stake-tag').innerHTML = `${M.icon} ${M.label} · ` + (bet
      ? `BET ${ptsHTML()} ${fmt(bet)} → ${fmt(boosted(bet * kol.payout))}`
      : `FREE · WIN ${ptsHTML()} +${fmt(modePts(kol, mode))}`);
    $('#upgrade-bar').classList.remove('gone');
    $('#taunt').classList.add('hidden'); $('#p-taunt').classList.add('hidden');
    $('#brace').classList.add('hidden');
    renderHp(true); renderUpgrades(); renderPowerups();
    if (Scene) { Scene.setHelmet(false); Scene.setRage(false); }
    show('fight');
    sayPlayer(profile().phrase);
    setTimeout(() => F && F.kol === kol && say(pick(kol.taunts)), 900);
    playerTurn();
  }

  function say(text) {
    const t = $('#taunt'); t.textContent = text; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(say.t); say.t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  function sayPlayer(text) {
    const t = $('#p-taunt'); t.textContent = text; t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(sayPlayer.t); sayPlayer.t = setTimeout(() => t.classList.add('hidden'), 2000);
  }

  function renderHp(instant) {
    const set = (who, hp, max) => {
      const pct = Math.max(0, hp / max * 100);
      const fill = $(`#${who}-hp`), lag = $(`#${who}-hp-lag`);
      if (instant) { fill.style.transition = lag.style.transition = 'none'; }
      fill.style.width = pct + '%'; lag.style.width = pct + '%';
      fill.classList.toggle('low', pct < 30);
      $(`#${who}-hp-txt`).textContent = `${Math.max(0, Math.ceil(hp))} / ${max}`;
      if (instant) { void fill.offsetWidth; fill.style.transition = lag.style.transition = ''; }
    };
    set('p', F.pHp, F.pMax); set('k', F.kHp, F.kMax);
    if (Scene && Scene.player) Scene.player.setDamage(1 - F.pHp / F.pMax);
    if (Scene && Scene.kol) Scene.kol.setDamage(1 - F.kHp / F.kMax);
  }

  function renderUpgrades() {
    $$('.upg-btn').forEach(b => {
      const type = b.dataset.upgrade, lvl = S.upgrades[type], max = lvl >= SAK.PLAYER.maxUpgradeLevel;
      b.querySelector('[data-lvl]').textContent = max ? 'MAX' : 'LV ' + (lvl + 1);
      b.querySelector('[data-cost]').textContent = max ? '—' : fmt(upgradeCost(type));
      b.disabled = max || !P.canAfford(upgradeCost(type));
    });
  }

  /* --- power-ups (limited-use consumables) ---------------------------- */
  function renderPowerups() {
    const rail = $('#powerups');
    rail.innerHTML = Object.values(SAK.POWERUPS).map(pu => {
      const own = S.powerups[pu.id] || 0, used = F && F.pu.used[pu.id];
      const active = F && ((pu.id === 'fist' && F.fireArmed) || (pu.id === 'helmet' && F.pu.helmet > 0) || (pu.id === 'rage' && F.pu.rage > 0));
      const badge = own > 0 ? '×' + own : `${ptsHTML()}${pu.cost}`;
      return `<button class="pu-btn ${pu.id} ${active ? 'active' : ''} ${used && !active ? 'used' : ''} ${!own && !P.canAfford(pu.cost) ? 'cant' : ''}" data-pu="${pu.id}" title="${pu.desc}">
        <span class="pu-ico">${pu.icon}</span><span class="pu-lbl">${pu.name}</span><span class="pu-badge">${badge}</span></button>`;
    }).join('');
    rail.querySelectorAll('.pu-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); usePowerup(b.dataset.pu); }));
    const st = [];
    if (F && F.fireArmed) st.push('🔥 GOLDEN FIST ARMED');
    if (F && F.pu.helmet) st.push(`⛑ HELMET ×${F.pu.helmet}`);
    if (F && F.pu.rage) st.push(`😤 RAGE ×${F.pu.rage}`);
    $('#pu-status').innerHTML = st.map(t => `<span>${t}</span>`).join('');
  }

  function usePowerup(id) {
    A.unlock();
    const pu = SAK.POWERUPS[id];
    if (!F || ['over', 'done'].includes(F.turn)) return;
    if (id === 'fist' && F.fireArmed) {           // un-arm (refund the charge)
      F.fireArmed = false; F.pu.used.fist = false; S.powerups.fist++; SAK.Storage.save();
      if (Scene) Scene.setFireArmed(false);
      return renderPowerups();
    }
    if (F.pu.used[id]) return toast(`${pu.icon} One ${pu.name} per fight, greedy.`);
    if (!(S.powerups[id] > 0)) {                    // buy one with PTS
      if (!P.spend(pu.cost)) return toast(`${pu.icon} ${pu.name} costs ${pu.cost} PTS. You're down bad.`);
      S.powerups[id] = 1; A.coin();
    }
    S.powerups[id]--; F.pu.used[id] = true; SAK.Storage.save();
    haptic(30);
    if (id === 'fist') { F.fireArmed = true; A.fire(); if (Scene && F.turn === 'player') Scene.setFireArmed(true); }
    if (id === 'helmet') { F.pu.helmet = pu.hits; A.brace(); if (Scene) Scene.setHelmet(true); }
    if (id === 'rage') { F.pu.rage = pu.slaps; A.fire(); if (Scene) Scene.setRage(true); if (F.turn === 'player') SAK.Meter.start(meterSpeed(F.kol) * pu.meterMult); }
    toast(`${pu.icon} ${pu.name}: ${pu.desc}`);
    renderPowerups(); renderUpgrades();
  }

  /* --- upgrades (PTS) ------------------------------------------------- */
  $$('.upg-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); buyUpgrade(b.dataset.upgrade, b); }));

  function buyUpgrade(type, btn) {
    A.unlock();
    if (S.upgrades[type] >= SAK.PLAYER.maxUpgradeLevel) return toast('Already maxed!');
    const cost = upgradeCost(type);
    if (!P.spend(cost)) return toast(`Need ${fmt(cost)} PTS — win fights to earn more`);
    S.upgrades[type]++;
    SAK.Storage.save();
    A.coin(); haptic(20);
    if (F && !F.started) { F.pMax = playerMaxHp(); F.pHp = F.pMax; renderHp(); }  // applies before 1st slap
    if (btn) {
      const r = btn.getBoundingClientRect(), app = appRect();
      floatText(r.left - app.left + r.width / 2, r.top - app.top, type === 'health' ? `+${SAK.PLAYER.hpPerLevel} HP` : `+${SAK.PLAYER.powerPerLevel} POWER`, 'good');
    }
    renderUpgrades();
  }

  /* --- player turn ------------------------------------------------------ */
  function playerTurn() {
    F.turn = 'player';
    const p = $('#prompt'); p.textContent = 'TAP TO SLAP'; p.classList.remove('kol-turn', 'hidden');
    $('#meter').classList.remove('dim');
    if (F.fireArmed && Scene) Scene.setFireArmed(true);
    SAK.Meter.start(meterSpeed(F.kol) * (F.pu.rage > 0 ? SAK.POWERUPS.rage.meterMult : 1));
  }

  async function playerSlap() {
    F.turn = 'busy';
    F.started = true; F.slaps++;
    $('#upgrade-bar').classList.add('gone');
    $('#prompt').classList.add('hidden');
    const { zone } = SAK.Meter.lock();
    let grade = zone;
    const fire = F.fireArmed;
    // Golden Fist never misses: bump weak/miss up to good
    if (fire && (grade.id === 'miss' || grade.id === 'weak')) grade = SAK.METER.zones.find(z => z.id === 'good');
    if (fire) F.fireArmed = false;
    const rage = F.pu.rage > 0;
    if (rage) { F.pu.rage--; if (!F.pu.rage && Scene) Scene.setRage(false); }
    renderPowerups();
    if (grade.id === 'perfect' && Scene) Scene.laserEyes('player', 1.1);   // 👁👁 perfect-slap laser eyes

    const dmg = Math.round(playerPower() * grade.mult * (fire ? SAK.POWERUPS.fist.mult : 1) * (rage ? SAK.POWERUPS.rage.damageMult : 1));
    const doImpact = () => {
      const pos = Scene ? Scene.screenPos('kol') : { x: 240, y: 300 };
      if (grade.id === 'miss') { F.duel.p = 0; A.miss(); floatText(pos.x, pos.y - 20, 'NGMI!', 'miss'); say(pick(SAK.COPY.missTaunts)); return; }
      F.duel.p = dmg;
      F.kHp = Math.max(0, F.kHp - dmg);
      F.hits++;
      F.maxHit = Math.max(F.maxHit, dmg);
      if (grade.id === 'perfect') { F.perfects++; A.perfect(); if (Math.random() < 0.5) sayPlayer(profile().phrase); }
      A.slap(grade.mult * (fire ? 1.4 : 1));
      haptic(grade.id === 'perfect' || fire ? 60 : 30);
      if (fire) flash('#ffb000'); else if (grade.id === 'perfect') flash('#39ff88');
      floatText(pos.x, pos.y - 30, `${fire ? '🔥 ' : rage ? '😤 ' : grade.id === 'perfect' ? '👁👁 ' : ''}${grade.label}<small>-${dmg}</small>`, fire ? 'fire' : grade.id);
      const pk = $('#k-portrait'); pk.classList.remove('hit'); void pk.offsetWidth; pk.classList.add('hit');
      pk.innerHTML = SAK.avatarSVG(F.kol.look, { blush: true });
      renderHp();
    };

    if (Scene) await Scene.slap('player', { grade: grade.id, fire, windup: 0.32, onImpact: doImpact });
    else { await wait(0.4); doImpact(); }

    if (F.mode === 'classic' && F.kHp <= 0) return knockout('kol');
    await wait(0.25);
    kolTurn();
  }

  /* --- KOL turn (AI) ------------------------------------------------------ */
  function rollAiGrade(kol) {
    const a = kol.accuracy, r = Math.random();
    const pPerfect = 0.06 + a * 0.3, pGood = 0.3 + a * 0.35, pMiss = 0.03 + (1 - a) * 0.14;
    const id = r < pPerfect ? 'perfect' : r < pPerfect + pGood ? 'good' : r < 1 - pMiss ? 'weak' : 'miss';
    return SAK.METER.zones.find(z => z.id === id);
  }

  async function kolTurn() {
    F.turn = 'kol';
    SAK.Meter.unfreeze(); SAK.Meter.stop();
    $('#meter').classList.add('dim');
    const p = $('#prompt'); p.textContent = `${F.kol.name.toUpperCase()}'S TURN`; p.classList.add('kol-turn'); p.classList.remove('hidden');
    if (Math.random() < 0.35) say(pick(F.kol.taunts));
    await wait(0.45);

    const grade = rollAiGrade(F.kol);
    const windup = 0.55 + Math.random() * 0.55;
    const impactIn = windup + 0.06 + 0.1;  // matches Scene3D.slap timing
    // brace ring shrinks onto the target exactly at impact
    const brace = $('#brace'), ring = $('#brace-ring');
    brace.classList.remove('hidden', 'good', 'bad');
    ring.style.transition = 'none'; ring.style.transform = 'scale(1.9)'; void ring.offsetWidth;
    ring.style.transition = `transform ${impactIn}s linear`; ring.style.transform = 'scale(0.54)';
    p.textContent = 'TAP TO BRACE!';
    F.brace = { impactAt: performance.now() + impactIn * 1000, tapped: false, braced: false };
    F.turn = 'kol-windup';
    if (grade.id === 'perfect' && Scene) setTimeout(() => Scene.laserEyes('kol', 0.9), windup * 1000);

    const doImpact = () => {
      F.turn = 'busy';
      const pos = Scene ? Scene.screenPos('player') : { x: 240, y: 400 };
      brace.classList.add('hidden');
      if (grade.id === 'miss') { F.duel.k = 0; A.miss(); floatText(pos.x, pos.y - 40, 'DODGED! 😎', 'good'); return; }
      const braced = F.brace.braced;
      const helmet = F.pu.helmet > 0;
      if (helmet) { F.pu.helmet--; if (!F.pu.helmet && Scene) setTimeout(() => Scene.setHelmet(false), 400); renderPowerups(); }
      const dmg = Math.round(F.kol.power * grade.mult * (0.9 + Math.random() * 0.2) * (braced ? SAK.BRACE.damageMult : 1) * (helmet ? SAK.POWERUPS.helmet.damageMult : 1));
      F.pHp = Math.max(0, F.pHp - dmg);
      F.duel.k = dmg;
      A.slap(grade.mult * (braced ? 0.6 : 1)); haptic(braced ? 20 : 80);
      flash(braced ? '#2ee66b' : '#ff3b5c');
      floatText(pos.x, pos.y - 50, `${helmet ? '⛑ ' : ''}${braced ? 'BRACED! ' : grade.id === 'perfect' ? 'REKT! ' : ''}<small>-${dmg}</small>`, braced ? 'good' : 'dmg-in');
      const pp = $('#p-portrait'); pp.classList.remove('hit'); void pp.offsetWidth; pp.classList.add('hit');
      pp.innerHTML = SAK.avatarSVG(playerLook(), { blush: true });
      renderHp();
    };

    if (Scene) await Scene.slap('kol', { grade: grade.id, windup, onImpact: doImpact });
    else { await wait(impactIn); doImpact(); }
    brace.classList.add('hidden');
    if (F.mode === 'duel') return resolveDuel();
    if (F.pHp <= 0) return knockout('player');
    await wait(0.2);
    playerTurn();
  }

  function tryBrace() {
    const b = F.brace; if (!b || b.tapped) return;
    b.tapped = true;
    const early = (b.impactAt - performance.now()) / 1000;
    const ok = early >= -0.05 && early <= SAK.BRACE.window;
    b.braced = ok;
    $('#brace').classList.add(ok ? 'good' : 'bad');
    A.brace();
    if (Scene) { Scene.setBrace(true); setTimeout(() => Scene.setBrace(false), 450); }
    if (!ok) $('#prompt').textContent = 'TOO EARLY!';
  }

  /* --- quick duel: compare the single slaps -------------------------------- */
  async function resolveDuel() {
    F.turn = 'over';
    SAK.Meter.stop();
    $('#prompt').classList.add('hidden');
    const p = F.duel.p || 0, k = F.duel.k || 0;
    const el = document.createElement('div');
    el.id = 'duel-score'; el.className = 'duel-score';
    el.innerHTML = `<span class="${p > k ? 'win' : p < k ? 'lose' : ''}">${p}</span><span class="vs-mini">VS</span><span class="${k > p ? 'win' : k < p ? 'lose' : ''}">${k}</span>`;
    $('#fx-layer').appendChild(el);
    A.click();
    await wait(1.2);
    el.remove();
    if (p === k) { banner('CRAB MARKET 🦀', '#ffd23f', 1200); await wait(1.2); return endFight(false, true); }
    knockout(p > k ? 'kol' : 'player');
  }

  /* --- knockout & results ------------------------------------------------- */
  async function knockout(loser) {
    F.turn = 'over';
    SAK.Meter.stop();
    $('#prompt').classList.add('hidden');
    $('#brace').classList.add('hidden');
    A.ko(); haptic([60, 40, 120]);
    if (loser === 'kol') $('#k-portrait').innerHTML = SAK.avatarSVG(F.kol.look, { ko: true, blush: true });
    else $('#p-portrait').innerHTML = SAK.avatarSVG(playerLook(), { ko: true, blush: true });
    const ko = Scene ? Scene.knockout(loser) : wait(1.2);
    if (Scene && loser === 'kol') Scene.coinRain(70);                       // 🪙 coin rain on a win
    banner(loser === 'kol' ? pick(['K.O.! WAGMI', 'SENT TO ZERO!', 'RUGGED! K.O.']) : pick(['NGMI…', 'LIQUIDATED!', 'REKT!']), loser === 'kol' ? '#39ff88' : '#ff3b5c', 1400);
    await ko;
    endFight(loser === 'kol');
  }

  function endFight(win, draw) {
    const k = F.kol, st = S.stats, R = SAK.REWARDS, PR = SAK.POINT_REWARDS;
    const modeMult = SAK.MODES[F.mode].ptsMult;
    const boost = V.boost, boostMul = 1 + boost;
    const streakBefore = st.streak;
    st.perfects += F.perfects;
    st.biggestHit = Math.max(st.biggestHit, F.maxHit);

    // ---- match PTS (always: free-to-play, play-to-earn) ----
    const rows = [];
    let pts;
    if (win) {
      const base = k.winPts * modeMult;
      const streakPts = base * PR.streakPct * Math.min(streakBefore, PR.streakCap);
      rows.push([F.mode === 'duel' ? 'Duel win (½ pts, ⚡ fast)' : 'Knockout reward', base], [`Based slaps (${F.perfects}★)`, F.perfects * PR.perPerfect]);
      if (streakPts) rows.push([`Win streak (${streakBefore}🔥)`, streakPts]);
      pts = base + F.perfects * PR.perPerfect + streakPts;
    } else if (draw) {
      rows.push(['Crab market consolation', PR.lossBase * 2]);
      pts = PR.lossBase * 2;
    } else {
      rows.push(['Participation', PR.lossBase], [`Hits landed (${F.hits})`, F.hits * PR.perHitLanded]);
      pts = PR.lossBase + F.hits * PR.perHitLanded;
    }
    if (boost) rows.push([`Vault boost (${V.tier.name} +${Math.round(boost * 100)}%)`, pts * boost]);
    pts = Math.round(pts * boostMul);
    P.add(pts, true);

    // ---- optional PTS bet ----
    let betHtml = '', betTotal = 0;
    if (F.bet) {
      if (win) {
        const base = F.bet * k.payout;
        const perfectBonus = F.bet * R.perfectBonus * Math.min(F.perfects, R.perfectBonusCap);
        const streakBonus = F.bet * R.streakBonus * Math.min(streakBefore, R.streakBonusCap);
        const sub = base + perfectBonus + streakBonus;
        betTotal = Math.round(sub * boostMul);
        P.add(F.bet, false);                 // stake returned (not "earned")
        P.add(betTotal - F.bet, true);       // profit counts towards lifetime PTS
        betHtml = `
          <div class="bd-head">BET</div>
          <div><span>Bet ${fmt(F.bet)} × ${k.payout.toFixed(1)}</span><b>+${fmt(base)}</b></div>
          ${perfectBonus ? `<div><span>Perfect bonus</span><b>+${fmt(perfectBonus)}</b></div>` : ''}
          ${streakBonus ? `<div><span>Streak bonus</span><b>+${fmt(streakBonus)}</b></div>` : ''}
          ${boost ? `<div><span>Vault boost +${Math.round(boost * 100)}%</span><b>+${fmt(sub * boost)}</b></div>` : ''}
          <div class="total"><span>BET PAYOUT</span><span>${ptsHTML('')} ${fmt(betTotal)}</span></div>`;
      } else if (draw) {
        P.add(F.bet, false);
        betHtml = `<div class="bd-head">BET</div><div><span>Draw: bet refunded</span><b>${fmt(F.bet)}</b></div>`;
      } else {
        betHtml = `<div class="bd-head">BET</div><div><span>Bet got rugged</span><b class="neg">-${fmt(F.bet)}</b></div>`;
      }
    }

    if (win) { st.wins++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); S.beaten[k.id] = true; A.win(); }
    else if (!draw) { st.losses++; st.streak = 0; A.lose(); }
    SAK.Storage.save();

    const C = SAK.COPY, sub = t => esc(t.replace('{k}', k.name).replace('{t}', pick(k.taunts)));
    let html = draw
      ? `<div class="result-title" style="color:#ffd23f">CRAB MARKET 🦀</div>
         ${SAK.avatarSVG(k.look)}
         <div class="result-sub">${F.duel.p} vs ${F.duel.k}. Nobody pumped, nobody dumped.</div>`
      : win
      ? `<div class="result-title">${pick(C.winTitles)}</div>
         ${SAK.avatarSVG(k.look, { ko: true, blush: true })}
         <div class="result-sub">${sub(pick(C.winSubs))}${F.mode === 'duel' ? ` (${F.duel.p} vs ${F.duel.k})` : ''}</div>`
      : `<div class="result-title">${pick(C.loseTitles)}</div>
         ${SAK.avatarSVG(playerLook(), { ko: true, blush: true })}
         <div class="result-sub">${sub(pick(C.loseSubs))}${F.mode === 'duel' ? ` (${F.duel.p} vs ${F.duel.k})` : ''}<br><small>Tip: upgrade ❤ / ✊ or pop a power-up (🔥 ⛑ 😤)</small></div>`;
    html += `<div class="breakdown">
        <div class="bd-head">PLAY-TO-EARN</div>
        ${rows.map(([l, v]) => `<div><span>${l}</span><b>+${fmt(v)}</b></div>`).join('')}
        <div class="total pts-total"><span>MATCH PTS</span><span>${ptsHTML('')} +${fmt(pts)}</span></div>
        ${betHtml}
      </div>`;
    if (!F.bet && win) html += `<p class="fine">💡 Bet PTS next time for x${k.payout.toFixed(1)}. Scared money don't make money.</p>`;
    const total = pts + betTotal;
    setTimeout(() => {
      const app = appRect(), pp = $('#pts-pill').getBoundingClientRect();
      floatText(pp.left - app.left + 30, pp.bottom - app.top + 30, `+${fmt(total)}`, 'pts-gain');
      A.coin();
    }, 500);

    const list = roster(), idx = list.findIndex(x => x.id === k.id), next = list[idx + 1];
    const reBet = F.bet && P.canAfford(F.bet) ? F.bet : 0;
    html += `<div class="result-btns">
        <button class="btn btn-yellow" id="r-rematch">↻ RUN IT BACK${reBet ? ` · BET ${fmt(reBet)}` : ' (FREE)'}</button>
        ${win && next && !k.pvp ? `<button class="btn btn-red" id="r-next">APE INTO ${esc(next.name)} →</button>` : ''}
        <div class="row">
          <button class="btn btn-purple" id="r-pick">${k.pvp ? 'PVP LOBBY' : 'PICK KOL'}</button>
          <button class="btn btn-grey" id="r-menu">TOUCH GRASS</button>
        </div>
      </div>`;
    const card = $('#result-card');
    card.className = 'result-card ' + (win ? 'win' : 'lose');
    card.innerHTML = html;
    show('result');
    $('#r-rematch').onclick = () => startFight(k, reBet, { mode: F.mode });
    if ($('#r-next')) $('#r-next').onclick = () => { selectedBet = 0; openPicker(idx + 1); };
    $('#r-pick').onclick = () => { if (k.pvp) { show('menu'); menuScene(); openPvp(); } else openPicker(); };
    $('#r-menu').onclick = () => { show('menu'); menuScene(); };
    F.turn = 'done';
    // newly unlocked UGC slot?
    const slotsNow = ugcSlotsUnlocked();
    if (slotsNow > lastSlots) setTimeout(() => toast(`✍ New KOL submission slot unlocked! (${slotsNow})`, 2600), 1200);
    lastSlots = slotsNow;
  }

  /* ================================================================= VAULT */
  let vaultAmt = 500, vaultTimer = 0;
  function openVault() {
    renderVault();
    $('#modal-vault').classList.remove('hidden');
    clearInterval(vaultTimer);
    vaultTimer = setInterval(() => {
      if ($('#modal-vault').classList.contains('hidden')) return clearInterval(vaultTimer);
      $('#v-yield').textContent = V.pending.toFixed(2);
    }, 200);
  }
  function renderVault() {
    const C = SAK.STAKING, t = V.tier, nx = V.nextTier();
    $('#v-staked').textContent = fmt(V.staked);
    $('#v-apr').textContent = Math.round(C.apr * 100) + '%';
    $('#v-yield').textContent = V.pending.toFixed(2);
    $('#v-tier').innerHTML = `TIER: <span style="color:${t.color}">${t.name}</span> · +${Math.round(t.boost * 100)}% rewards`
      + (nx ? `<br><small style="font-size:12px;opacity:.8">Stake ${fmt(nx.min - V.staked)} more for ${nx.name} (+${Math.round(nx.boost * 100)}%)</small>` : '');
    $('#v-tiers').innerHTML = C.tiers.slice(1).map(x => `<div class="${V.staked >= x.min ? 'on' : ''}" style="background:${x.color}">${x.name}<br>${x.min >= 1000 ? x.min / 1000 + 'K' : x.min}<br>+${Math.round(x.boost * 100)}%</div>`).join('');
    const opts = [100, 500, 1000, 5000];
    $('#v-amounts').innerHTML = opts.map(n => `<button data-amt="${n}" class="${n === vaultAmt ? 'selected' : ''}">${fmt(n)}</button>`).join('')
      + `<button data-amt="all" class="${vaultAmt === 'all' ? 'selected' : ''}">MAX</button>`;
    $$('#v-amounts button').forEach(b => b.onclick = () => { vaultAmt = b.dataset.amt === 'all' ? 'all' : +b.dataset.amt; A.click(); renderVault(); });
    const stakeN = vaultAmt === 'all' ? S.points : vaultAmt, unN = vaultAmt === 'all' ? V.staked : Math.min(vaultAmt, V.staked);
    $('#v-stake').textContent = `STAKE ${fmt(stakeN)}`;
    $('#v-stake').disabled = stakeN <= 0 || !P.canAfford(stakeN);
    $('#v-unstake').textContent = `UNSTAKE ${fmt(unN)}`;
    $('#v-unstake').disabled = V.staked <= 0;
    $('#v-note').textContent = `Spendable: ${fmt(S.points)} PTS. Yield is demo-accelerated (1 real min ≈ ${C.demoTimeScale / 1440} day). Staked PTS can't be spent or bet.`;
  }
  $('#v-stake').addEventListener('click', () => {
    const n = vaultAmt === 'all' ? S.points : vaultAmt;
    if (V.stake(n)) { A.coin(); toast(`Staked ${fmt(n)} PTS · tier ${V.tier.name}`); }
    renderVault(); renderMenu();
  });
  $('#v-unstake').addEventListener('click', () => {
    const n = vaultAmt === 'all' ? V.staked : Math.min(vaultAmt, V.staked);
    if (V.unstake(n)) { A.coin(); toast(`Unstaked ${fmt(n)} PTS`); }
    renderVault(); renderMenu();
  });
  $('#v-claim').addEventListener('click', () => {
    const got = V.claim();
    if (got) { A.coin(); toast(`Claimed ${fmt(got)} PTS yield`); } else toast('Not enough yield yet (min 1 PTS)');
    renderVault();
  });

  /* =========================================================== LEADERBOARD */
  let lbTab = 'global';
  function openLeaderboard(tab) {
    A.unlock(); A.click();
    lbTab = tab || lbTab;
    const me = { name: profile().name + ' (you)', pts: S.stats.lifetimePts, wins: S.stats.wins };
    const list = lbTab === 'global' ? SAK.Leaderboard.global(me) : SAK.Leaderboard.friends(me);
    $$('.lb-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === lbTab));
    $('#lb-note').textContent = lbTab === 'global'
      ? 'Ranked by lifetime PTS earned. Local prototype board (simulated degens).'
      : 'Friends list is a stub for the soft launch. Invite link = this page.';
    $('#lb-invite').classList.toggle('hidden', lbTab !== 'friends');
    const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '#' + r;
    $('#lb-list').innerHTML = list.map(e => `
      <div class="lb-row ${e.me ? 'me' : ''}">
        <span class="rk">${medal(e.rank)}</span>
        <span>${lbTab === 'friends' ? `<span class="dot ${e.online ? 'on' : ''}"></span>` : ''}${esc(e.name)}<small>${e.wins} wins</small></span>
        <span class="pt">${ptsHTML()}${fmt(e.pts)}</span>
      </div>`).join('');
    $('#modal-lb').classList.remove('hidden');
    const meRow = $('#lb-list .lb-row.me'); if (meRow) meRow.scrollIntoView({ block: 'center' });
  }
  $('#btn-leaderboard').addEventListener('click', () => openLeaderboard());
  $$('.lb-tabs button').forEach(b => b.addEventListener('click', () => openLeaderboard(b.dataset.tab)));
  $('#lb-invite').addEventListener('click', async () => {
    const link = SAK.Leaderboard.inviteLink();
    try { await navigator.clipboard.writeText(link); toast('📨 Invite link copied. Go recruit some degens.'); }
    catch (e) { prompt('Copy this invite link:', link); }
  });

  /* ============================================================ PVP (stub) */
  // Lists fake online players; "challenging" anyone (or Quick Match) shows a
  // searching state and then falls back to an AI stand-in. See matchmaking.js.
  let pvpMode = 'classic', pvpWager = 0, pvpTimer = 0, pvpT0 = 0;
  async function openPvp() {
    A.unlock();
    $('#pvp-lobby').classList.remove('hidden'); $('#pvp-search').classList.add('hidden');
    renderModes($('#pvp-modes'), pvpMode, m => { pvpMode = m; openPvp(); });
    const wagers = [0, 100, 250, 500, 1000];
    if (!P.canAfford(pvpWager)) pvpWager = 0;
    $('#pvp-bets').innerHTML = wagers.map(b => `<button class="bet-chip ${b === pvpWager ? 'selected' : ''} ${b && !P.canAfford(b) ? 'locked' : ''}" data-bet="${b}">${b ? ptsHTML() + b : 'FREE'}</button>`).join('');
    $$('#pvp-bets .bet-chip').forEach(c => c.onclick = () => {
      const b = +c.dataset.bet;
      if (b && !P.canAfford(b)) return toast('Not enough PTS. Down bad.');
      pvpWager = b; A.click(); openPvp();
    });
    $('#pvp-wager-hint').textContent = pvpWager ? `winner takes ~${fmt(pvpWager * 2)} PTS` : 'friendly slap, no wager';
    const list = await SAK.Matchmaking.listOnline();
    $('#pvp-count').textContent = `${list.filter(p => p.status === 'online').length} online (simulated)`;
    $('#pvp-list').innerHTML = list.map((p, i) => `
      <div class="pvp-row ${p.status === 'online' ? '' : 'busy'}">
        ${SAK.avatarSVG(p.look)}
        <div><div class="pv-name"><span class="pv-dot"></span>${esc(p.name)}</div>
          <div class="pv-meta">${p.rank} · ${p.wins} W · ${p.winRate}% · ${p.status}</div></div>
        <button data-i="${i}" ${p.status === 'online' ? '' : 'disabled'}>${p.status === 'online' ? 'SLAP' : 'BUSY'}</button>
      </div>`).join('');
    $$('#pvp-list button[data-i]').forEach(b => b.onclick = () => startPvpSearch(list[+b.dataset.i]));
    $('#modal-pvp').classList.remove('hidden');
  }
  async function startPvpSearch(target) {
    A.click();
    $('#pvp-lobby').classList.add('hidden'); $('#pvp-search').classList.remove('hidden');
    const st = $('#pvp-status'); st.classList.remove('done');
    pvpT0 = performance.now();
    clearInterval(pvpTimer);
    pvpTimer = setInterval(() => {
      const sec = Math.floor((performance.now() - pvpT0) / 1000);
      $('#pvp-timer').textContent = `0:${String(sec).padStart(2, '0')}`;
    }, 250);
    const res = await SAK.Matchmaking.findMatch({ target, wager: pvpWager, mode: pvpMode }, (msg, done) => {
      st.textContent = msg; st.classList.toggle('done', done);
    });
    clearInterval(pvpTimer);
    if ($('#modal-pvp').classList.contains('hidden')) return;   // cancelled
    $('#modal-pvp').classList.add('hidden');
    // AI stand-in: wager behaves like a normal PTS bet (payout x opponent multiplier)
    startFight(res.opponent, pvpWager, { mode: pvpMode, pvp: true });
  }
  $('#btn-pvp').addEventListener('click', () => { A.click(); openPvp(); });
  $('#pvp-quick').addEventListener('click', () => startPvpSearch(null));
  $('#pvp-cancel').addEventListener('click', () => {
    SAK.Matchmaking.cancel(); clearInterval(pvpTimer);
    $('#pvp-lobby').classList.remove('hidden'); $('#pvp-search').classList.add('hidden');
  });

  /* --- input: tap anywhere on the fight screen --------------------------- */
  function onTap(e) {
    if (screen !== 'fight' || !F) return;
    if (e && e.target && e.target.closest && e.target.closest('button, .modal')) return;
    if (!$('#modal-settings').classList.contains('hidden')) return;
    A.unlock();
    if (F.turn === 'player') playerSlap();
    else if (F.turn === 'kol-windup') tryBrace();
  }
  $('#screen-fight').addEventListener('pointerdown', onTap);
  window.addEventListener('keydown', e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if ((e.code === 'Space' || e.code === 'Enter') && screen === 'fight') { e.preventDefault(); onTap(null); }
    if (screen === 'fight' && { KeyF: 1, KeyH: 1, KeyR: 1 }[e.code]) usePowerup({ KeyF: 'fist', KeyH: 'helmet', KeyR: 'rage' }[e.code]);
  });

  /* ============================================================== SETTINGS */
  $('#btn-settings').addEventListener('click', () => {
    A.unlock(); A.click();
    $('#set-sound').checked = S.settings.sound;
    $('#set-haptics').checked = S.settings.haptics;
    $('#btn-forfeit').classList.toggle('hidden', !(screen === 'fight' && F && !['over', 'done'].includes(F.turn)));
    renderMenu();
    $('#modal-settings').classList.remove('hidden');
  });
  $('#btn-close-settings').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));
  $('#set-sound').addEventListener('change', e => { S.settings.sound = e.target.checked; SAK.Storage.save(); });
  $('#set-haptics').addEventListener('change', e => { S.settings.haptics = e.target.checked; SAK.Storage.save(); });
  $('#btn-forfeit').addEventListener('click', () => {
    $('#modal-settings').classList.add('hidden');
    if (F && !['over', 'done', 'busy'].includes(F.turn)) { F.pHp = 0; renderHp(); knockout('player'); }
  });
  $('#btn-disconnect').addEventListener('click', () => {
    W.disconnect(); $('#modal-settings').classList.add('hidden'); toast('Wallet disconnected'); renderMenu();
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Reset points, upgrades, fan KOLs and stats?')) return;
    SAK.Storage.reset(); location.reload();
  });
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));

  /* ======================================================= pump/dump ticker */
  function buildTicker() {
    const coins = ['$SLAP', '$FROGGO', '$WOOFY', '$MOONCAT', '$HODL', '$GMGM', '$REKT', '$PALM', '$CHEEK', '$WAGMI', '$NGMI', '$LAMBO', '$COPE', '$PUMP'];
    const items = coins.map(c => {
      const up = Math.random() > 0.38, pct = up ? (Math.random() * 900 + 5) : -(Math.random() * 90 + 1);
      return `<span class="tk ${up ? 'up' : 'down'}">${c} ${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(pct > 100 || pct < -10 ? 0 : 1)}%</span>`;
    }).join('<span class="tk-sep">•</span>');
    const extra = '<span class="tk-sep">•</span><span class="tk gm">GM ☀</span><span class="tk-sep">•</span><span class="tk moon">TO THE MOON 🚀🌕</span><span class="tk-sep">•</span>';
    $('#ticker-track').innerHTML = `<div class="tk-run">${items}${extra}</div><div class="tk-run">${items}${extra}</div>`;
  }

  /* ================================================================== BOOT */
  function menuScene() {
    if (!Scene) return;
    Scene.setOpponent(pick(roster()).look); Scene.resetFight();
  }

  P.onChange(() => { renderPoints(); renderUpgrades(); if (F) renderPowerups(); if (screen === 'menu') renderMenu(); if (screen === 'pick') renderBets(); });
  W.onChange(() => renderMenu());

  function boot() {
    if (!S.powerups) S.powerups = { fist: 0, helmet: 1, rage: 1 };
    // one-time welcome bonus so bets/upgrades/staking are explorable immediately
    if (!S.welcomeGranted) {
      S.welcomeGranted = true;
      S.points += SAK.POINTS.welcomeBonus; SAK.Storage.save();
      setTimeout(() => toast(`🎁 Welcome! +${fmt(SAK.POINTS.welcomeBonus)} PTS to get slapping`, 2600), 600);
    }
    lastSlots = ugcSlotsUnlocked();
    SAK.Meter.build($('#meter'));
    buildTicker();
    try {
      if (!window.THREE) throw new Error('three.js failed to load');
      SAK.Scene3D.init($('#stage'));
      Scene = SAK.Scene3D;
      Scene.setPlayer(playerLook());
      menuScene();
    } catch (err) {
      console.error(err);
      $('#webgl-error').classList.remove('hidden');
    }
    shownPts = S.points; $('#points').textContent = fmt(S.points);
    renderMenu();
    show('menu');
    // debug hook for console testing / automated smoke tests
    window.SAK_DEBUG = {
      state: S, get fight() { return F; }, roster, openVault, openSubmit, openPvp, openLeaderboard,
      startFight: (id, bet, mode) => startFight(roster().find(k => k.id === id) || roster()[0], bet, { mode })
    };
  }
  boot();
})();
