/* ─────────────────────────────────────────────────────────────────────────
 * QR encoder — byte mode, error correction M, versions 1 to 9.
 *
 * Why this exists rather than a build-time PNG: the pairing code is generated
 * in the TV's browser when the screen boots, so a QR baked at deploy time can
 * only ever point at the setup page and leave the six characters to be read off
 * the television and typed in by thumb. Encoding the code into the QR is what
 * turns scanning from a shortcut to the page into the whole of pairing.
 *
 * No CDN and no build step: this runs on a Fire TV, offline of everything
 * except the two APIs the display already talks to.
 *
 * Version 9 at level M holds 182 bytes. A setup URL with a code is about 45.
 * The ceiling is here so a longer domain never silently fails to encode.
 * ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  /* ── GF(256), primitive polynomial 0x11D ─────────────────────────────── */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    for (var i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* Generator polynomial for n error-correction codewords, highest degree first. */
  function rsPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1);
      for (var j = 0; j < next.length; j++) {
        // g[j] shifted up one degree, plus g[j-1] scaled by α^i. Swapping these
        // two terms reverses the polynomial, which still leaves a leading 1 and
        // so divides without error while producing entirely wrong parity.
        next[j] = ((j < g.length ? g[j] : 0) ^ (j > 0 ? mul(g[j - 1], EXP[i]) : 0));
      }
      g = next;
    }
    return g;
  }

  function ecFor(block, n) {
    var gen = rsPoly(n), res = block.slice(), i, j;
    for (i = 0; i < n; i++) res.push(0);
    for (i = 0; i < block.length; i++) {
      var lead = res[i];
      if (lead === 0) continue;
      for (j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], lead);
    }
    return res.slice(block.length);
  }

  /* ── per-version tables, level M ──────────────────────────────────────── */
  //            ecPerBlock, [[blockCount, dataCodewords], …]
  var SPEC = {
    1: [10, [[1, 16]]],           2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],           4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],           6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],           8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46]
  };
  var VERSION_BITS = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99 };

  function capacity(v) {
    var s = SPEC[v], total = 0;
    s[1].forEach(function (g) { total += g[0] * g[1]; });
    return total;
  }

  /* ── the eight mask patterns ──────────────────────────────────────────── */
  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i + j) % 2 + (i * j) % 3) % 2 === 0; }
  ];

  function bch15(data) {
    var v = data << 10;
    for (var i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
    return ((data << 10) | v) ^ 0x5412;
  }

  /* ── matrix construction ──────────────────────────────────────────────── */
  function makeMatrix(version, codewords, mask) {
    var n = version * 4 + 17, i, j, r, c;
    var m = new Array(n);
    for (i = 0; i < n; i++) { m[i] = new Array(n); for (j = 0; j < n; j++) m[i][j] = null; }

    function finder(top, left) {
      for (r = -1; r <= 7; r++) for (c = -1; c <= 7; c++) {
        var y = top + r, x = left + c;
        if (y < 0 || y >= n || x < 0 || x >= n) continue;
        m[y][x] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                  (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                  (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);

    /* Alignment BEFORE timing. The centre-is-occupied test is how a pattern
       that would sit on a finder gets skipped, so it has to run while the only
       occupied modules are the finders. Do timing first and the centres at
       (6, x) and (x, 6) are already filled, every one of those patterns is
       silently dropped, and the code still scans close up while failing on a
       camera far enough away to need them. */
    var pos = ALIGN[version];
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      var ay = pos[i], ax = pos[j];
      if (m[ay][ax] !== null) continue;
      for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) {
        m[ay + r][ax + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
      }
    }

    // timing, filling only what alignment has not already claimed
    for (i = 8; i < n - 8; i++) { if (m[i][6] === null) m[i][6] = i % 2 === 0;
                                  if (m[6][i] === null) m[6][i] = i % 2 === 0; }

    // version information, 7 and up
    if (version >= 7) {
      var vb = VERSION_BITS[version];
      for (i = 0; i < 18; i++) {
        var on = ((vb >> i) & 1) === 1;
        m[Math.floor(i / 3)][i % 3 + n - 11] = on;
        m[i % 3 + n - 11][Math.floor(i / 3)] = on;
      }
    }

    // format information (level M = 0b00) and the always-dark module
    var fb = bch15((0 << 3) | mask);
    for (i = 0; i < 15; i++) {
      var bit = ((fb >> i) & 1) === 1;
      if (i < 6)      m[i][8] = bit;
      else if (i < 8) m[i + 1][8] = bit;
      else            m[n - 15 + i][8] = bit;

      if (i < 8)      m[8][n - i - 1] = bit;
      else if (i < 9) m[8][7] = bit;
      else            m[8][15 - i - 1] = bit;
    }
    m[n - 8][8] = true;

    // data, bottom-right upward in two-module columns, skipping the timing column
    var inc = -1, row = n - 1, bitIndex = 7, byteIndex = 0;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var k = 0; k < 2; k++) {
          if (m[row][col - k] !== null) continue;
          var dark = false;
          if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          if (MASKS[mask](row, col - k)) dark = !dark;
          m[row][col - k] = dark;
          if (--bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
        row += inc;
        if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
      }
    }
    return m;
  }

  /* ── mask scoring, the four penalty rules ─────────────────────────────── */
  function penalty(m) {
    var n = m.length, score = 0, i, j, run, dark = 0;

    function line(get) {
      var s = 0, prev = null, len = 0, bits = [];
      for (var k = 0; k < n; k++) {
        var v = get(k); bits.push(v ? 1 : 0);
        if (v === prev) { len++; if (len === 5) s += 3; else if (len > 5) s += 1; }
        else { prev = v; len = 1; }
      }
      // 1:1:3:1:1 surrounded by four light modules, either orientation
      var str = bits.join('');
      var p1 = '10111010000', p2 = '00001011101';
      for (var t = 0; t + 11 <= str.length; t++) {
        var w = str.substr(t, 11);
        if (w === p1 || w === p2) s += 40;
      }
      return s;
    }
    for (i = 0; i < n; i++) {
      score += line(function (k) { return m[i][k]; });
      score += line(function (k) { return m[k][i]; });
    }
    for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) {
      var a = m[i][j];
      if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) score += 3;
    }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) dark++;
    var pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ── public: text in, module matrix out ───────────────────────────────── */
  function encode(text) {
    var bytes = [], i;
    // UTF-8. Domains and codes are ASCII, but a stray character must not corrupt
    // the length header and silently produce an unscannable code.
    var utf = unescape(encodeURIComponent(text));
    for (i = 0; i < utf.length; i++) bytes.push(utf.charCodeAt(i) & 0xff);

    var version = 0;
    for (var v = 1; v <= 9; v++) {
      // 4 bits mode + 8 bits length + data, rounded up to whole codewords
      if (capacity(v) >= Math.ceil((4 + 8 + bytes.length * 8) / 8)) { version = v; break; }
    }
    if (!version) throw new Error('qr: ' + bytes.length + ' bytes exceeds version 9');

    // bit stream: mode 0100, 8-bit length, data, terminator, pad
    var bits = [];
    function push(val, len) { for (var b = len - 1; b >= 0; b--) bits.push((val >> b) & 1); }
    push(4, 4); push(bytes.length, 8);
    for (i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var total = capacity(version) * 8;
    for (i = 0; i < 4 && bits.length < total; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      data.push(byte);
    }
    var PAD = [0xec, 0x11], p = 0;
    while (data.length < capacity(version)) data.push(PAD[p++ % 2]);

    // split into blocks, compute EC, interleave
    var spec = SPEC[version], ecLen = spec[0];
    var blocks = [], at = 0;
    spec[1].forEach(function (g) {
      for (var b = 0; b < g[0]; b++) { blocks.push(data.slice(at, at + g[1])); at += g[1]; }
    });
    var ecs = blocks.map(function (b) { return ecFor(b, ecLen); });

    var out = [], maxLen = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i = 0; i < maxLen; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < ecLen; i++) ecs.forEach(function (e) { out.push(e[i]); });

    // pick the mask with the lowest penalty
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var m = makeMatrix(version, out, mk), s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* Draw into a canvas at whole-pixel module size, because a QR resampled onto
     fractional pixels is exactly the kind of thing a phone camera fails on. */
  function draw(canvas, text, opts) {
    opts = opts || {};
    var m = encode(text), n = m.length;
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var want = opts.size || 400;
    var scale = Math.max(1, Math.floor(want / (n + quiet * 2)));
    var px = (n + quiet * 2) * scale;

    canvas.width = px; canvas.height = px;
    var g = canvas.getContext('2d');
    g.fillStyle = opts.light || '#ffffff';
    g.fillRect(0, 0, px, px);
    g.fillStyle = opts.dark || '#000000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (m[r][c]) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    return px;
  }

  global.BilalQR = { encode: encode, draw: draw };
})(this);
