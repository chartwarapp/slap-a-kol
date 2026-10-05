/* =========================================================================
 * Economy: PTS (the single in-game currency) + Stake Vault (PTS staking).
 * -------------------------------------------------------------------------
 * PTS live only in localStorage. The Vault moves PTS between the spendable
 * balance and a "staked" bucket that accrues APR yield and grants a reward
 * boost tier. Later this is where an SPL token / staking program plugs in.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Points = (function () {
  const S = () => SAK.Storage.state;
  const listeners = [];
  const emit = () => listeners.forEach(fn => fn(S().points));
  return {
    get balance() { return S().points; },
    canAfford: n => S().points >= n,
    /** @param earned false for refunds/principal (doesn't count to lifetime PTS) */
    add(n, earned) {
      n = Math.round(n);
      S().points += n;
      if (n > 0 && earned !== false) S().stats.lifetimePts += n;   // drives UGC slot unlocks
      SAK.Storage.save(); emit();
    },
    spend(n) {
      n = Math.round(n);
      if (S().points < n) return false;
      S().points -= n; SAK.Storage.save(); emit(); return true;
    },
    onChange(fn) { listeners.push(fn); }
  };
})();

SAK.Vault = (function () {
  const S = () => SAK.Storage.state;
  const C = () => SAK.STAKING;
  const listeners = [];
  const emit = () => listeners.forEach(fn => fn());
  const YEAR = 365 * 86400;

  /** Yield earned since the last settle (not yet added to `accrued`). */
  function unsettled() {
    const st = S().staking;
    if (!st.amount || !st.since) return 0;
    const sec = (Date.now() - st.since) / 1000 * C().demoTimeScale;
    return st.amount * C().apr * sec / YEAR;
  }
  /** Fold unsettled yield into `accrued` (call before changing the amount). */
  function settle() {
    const st = S().staking;
    st.accrued += unsettled();
    st.since = st.amount ? Date.now() : null;
  }
  function tierFor(amount) {
    const t = C().tiers; let cur = t[0];
    for (const x of t) if (amount >= x.min) cur = x;
    return cur;
  }

  return {
    get staked() { return S().staking.amount; },
    get pending() { return S().staking.accrued + unsettled(); },
    get tier() { return tierFor(S().staking.amount); },
    get boost() { return tierFor(S().staking.amount).boost; },
    nextTier() { return C().tiers.find(t => t.min > S().staking.amount) || null; },
    tierFor,
    stake(n) {
      n = Math.floor(n);
      if (n <= 0 || !SAK.Points.spend(n)) return false;
      settle(); S().staking.amount += n; S().staking.since = Date.now();
      SAK.Storage.save(); emit(); return true;
    },
    unstake(n) {
      n = Math.min(Math.floor(n), S().staking.amount);
      if (n <= 0) return false;
      settle(); S().staking.amount -= n;
      if (!S().staking.amount) S().staking.since = null;
      SAK.Points.add(n, false);
      SAK.Storage.save(); emit(); return true;
    },
    claim() {
      settle();
      const amt = Math.floor(S().staking.accrued);
      if (amt <= 0) return 0;
      S().staking.accrued -= amt;
      SAK.Points.add(amt, true);
      SAK.Storage.save(); emit(); return amt;
    },
    onChange(fn) { listeners.push(fn); }
  };
})();
