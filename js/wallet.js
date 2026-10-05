/* =========================================================================
 * Wallet adapter — MOCK Solana placeholder.
 * -------------------------------------------------------------------------
 * Today this only simulates a connect/disconnect and a fake base58 address.
 * It holds NO balance: the whole economy runs on in-game PTS (economy.js).
 *
 * Future (see README "Where a token plugs in later"):
 *   connect()    -> window.phantom.solana.connect()
 *   address      -> provider.publicKey.toBase58()
 *   + signMessage() for login, and token-account reads once SAK.SOLANA
 *     .tokenMint exists. The game UI only calls this interface.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Wallet = (function () {
  const S = () => SAK.Storage.state;
  const listeners = [];
  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

  // Fake base58-looking Solana address.
  function fakeAddress() {
    const abc = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < 44; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  async function connect() {
    await new Promise(r => setTimeout(r, 650));   // simulate wallet popup round-trip
    const st = S();
    if (!st.wallet.address) st.wallet.address = fakeAddress();
    st.wallet.connected = true;
    SAK.Storage.save(); emit();
    return { address: st.wallet.address };
  }

  function disconnect() { S().wallet.connected = false; SAK.Storage.save(); emit(); }

  function shortAddress() {
    const a = S().wallet.address;
    return a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  }

  return {
    connect, disconnect, shortAddress,
    onChange(fn) { listeners.push(fn); },
    get isConnected() { return !!S().wallet.connected; },
    get address() { return S().wallet.address; }
  };
})();
