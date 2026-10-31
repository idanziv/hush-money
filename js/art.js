/* HUSH MONEY - js/art.js  (owner: world-artist, Noa Ben-Ami)
 * Procedural sprites, pre-rendered once into offscreen canvases by PE.art.init().
 * People: 24x24 cells, atlas per look = 3 frames (x) by 8 dirs (y). Sprite centre = feet (sx, sy-2).
 * Props: 32x32 cells per dir (2nd drawImage). Glow: 48x48 pre-blurred rim halo per dir.
 * Every character and prop frame gets a baked 1 px dark outline (init only, no per-frame cost).
 * Nothing here touches the DOM at load time; look tables are plain data (usable headlessly).
 * #39FF14 is used ONLY by drawGlow / drawGroundRing.
 */
(function (PE) {
  'use strict';

  var art = PE.art = PE.art || {};
  var CELL = 24, PCELL = 32, GCELL = 48, ICELL = 16;
  var GLOW = '#39FF14';
  var TAU = Math.PI * 2;

  var PRESET_NAMES = ['detective', 'suit', 'trainer', 'dealer', 'hoodie', 'hipster', 'politician', 'contractor',
    'influencer', 'assistant', 'footballer', 'bookie', 'inspector', 'chef', 'protester', 'tourist', 'surfer',
    'jogger', 'grandma', 'vendor', 'lifeguard', 'sunbather', 'dog'];
  var PROPS = ['none', 'envelope', 'package', 'phone', 'sign', 'cards', 'cash', 'trashbag', 'clipboard', 'paddle', 'coffee'];
  var ACTIONS = ['kiss', 'deal', 'handoff', 'pose', 'shout', 'shake'];
  var ICONS = ['ball', 'heart', 'cash', 'pill', 'envelope', 'bang', 'question', 'camera'];
  var LOOKS_AMBIENT = [];
  for (var ai = 0; ai < 24; ai++) LOOKS_AMBIENT.push('amb' + ai);

  art.LOOKS_AMBIENT = LOOKS_AMBIENT;
  art.PRESETS = PRESET_NAMES.slice();
  art.PROPS = PROPS.slice();
  art.ACTIONS = ACTIONS.slice();
  art.ICONS = ICONS.slice();
  art.CELL = CELL;
  art.ready = false;

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }

  // ---------- look definitions (pure data) ----------
  // kind: person|lying|dog ; top: body colour ; style: coat suit tank hoodie vest jersey apron wetsuit flannel floral cardigan labcoat shirt chef
  var LOOKS = {
    detective: { skin: '#D9A57B', hair: '#3A2A1E', hairStyle: 'short', hat: 'fedora', hatColor: '#2A2420', band: '#D0302A', top: '#C8A86A', trim: '#6E5430', style: 'coat', shoes: '#1E1610', build: 1.18 },
    suit: { skin: '#E0B48C', hair: '#1E1A18', hairStyle: 'slick', top: '#262E44', trim: '#B8343A', style: 'suit', shoes: '#141414' },
    trainer: { skin: '#C68A5E', hair: '#1A1410', hairStyle: 'short', hat: 'headband', hatColor: '#E83E8C', top: '#E83E8C', style: 'tank', shoes: '#F2F2F2', build: 1.2 },
    dealer: { skin: '#B07A52', hair: '#1A1410', hairStyle: 'short', hat: 'hood', hatColor: '#25252B', top: '#25252B', style: 'hoodie', shoes: '#E8E8E8', extra: 'chain' },
    hoodie: { skin: '#E6BE98', hair: '#5A3A22', hairStyle: 'short', hat: 'hood', hatColor: '#6E6E7A', top: '#6E6E7A', style: 'hoodie', shoes: '#3A3A40' },
    hipster: { skin: '#EAC4A0', hair: '#6A4428', hairStyle: 'short', hat: 'beanie', hatColor: '#C99A2E', top: '#A8423A', trim: '#5A1E1A', style: 'flannel', shoes: '#6A4A2A', extra: 'beard' },
    politician: { skin: '#E7BC96', hair: '#D8D8D8', hairStyle: 'slick', top: '#4B5060', trim: '#2F5FA8', style: 'suit', shoes: '#141414', build: 1.15 },
    contractor: { skin: '#C4875A', hair: '#2A1A10', hairStyle: 'short', hat: 'hardhat', hatColor: '#F2C230', top: '#F07A1A', trim: '#E8E8E8', sleeve: '#5A6A7A', style: 'vest', shoes: '#5A3A1E', build: 1.1 },
    influencer: { skin: '#F0C8A8', hair: '#F2D27A', hairStyle: 'long', top: '#F27BB4', style: 'tank', shoes: '#F2F2F2', extra: 'sunglasses', build: 0.9 },
    assistant: { skin: '#D8A880', hair: '#2A1E16', hairStyle: 'ponytail', top: '#F2F2F2', trim: '#3A6AC0', style: 'shirt', shoes: '#1E1E1E', extra: 'lanyard', build: 0.92 },
    footballer: { skin: '#8A5A3A', hair: '#141010', hairStyle: 'curly', top: '#3E8FD8', trim: '#FFFFFF', style: 'jersey', shoes: '#F2C230', build: 1.05 },
    bookie: { skin: '#D8A27A', hair: '#2A2A2A', hairStyle: 'bald', top: '#E07A2E', trim: '#7A3A8A', style: 'floral', shoes: '#F2F2F2', extra: 'chain', build: 1.2 },
    inspector: { skin: '#E2B48E', hair: '#6A6A6A', hairStyle: 'short', hat: 'cap', hatColor: '#2C3E5C', top: '#ECECEC', trim: '#B0B0B0', style: 'labcoat', shoes: '#1E1E1E' },
    chef: { skin: '#C9926A', hair: '#1A1A1A', hairStyle: 'short', hat: 'toque', hatColor: '#FFFFFF', top: '#F5F5F0', trim: '#2A2A2A', style: 'chef', shoes: '#1E1E1E', build: 1.1 },
    protester: { skin: '#DDAA80', hair: '#3A2412', hairStyle: 'curly', hat: 'headband', hatColor: '#C0392B', top: '#D04A2A', style: 'shirt', shoes: '#3A3A40' },
    tourist: { skin: '#F2A88C', hair: '#C9A060', hairStyle: 'short', hat: 'bucket', hatColor: '#D8C8A0', top: '#3AA0C8', trim: '#F2E24A', style: 'floral', shoes: '#E8E0D0', extra: 'camera', bare: true, build: 1.05 },
    surfer: { skin: '#C8905E', hair: '#E8C870', hairStyle: 'long', top: '#1E2228', trim: '#2E8A9A', style: 'wetsuit', shoes: '#C8905E' },
    jogger: { skin: '#B88058', hair: '#2A1A10', hairStyle: 'short', hat: 'cap', hatColor: '#F2F2F2', top: '#FF8C42', style: 'tank', shoes: '#3A6AC0' },
    grandma: { skin: '#E8C0A0', hair: '#C8C8CC', hairStyle: 'bun', top: '#7A5A8A', trim: '#E8D8A0', style: 'cardigan', shoes: '#4A3A30', build: 0.9 },
    vendor: { skin: '#B8825A', hair: '#1A1A1A', hairStyle: 'short', hat: 'cap', hatColor: '#B8343A', top: '#F0EDE4', sleeve: '#2E5A8A', style: 'apron', shoes: '#2A2A2A', build: 1.1 },
    lifeguard: { skin: '#B07848', hair: '#1A1410', hairStyle: 'short', hat: 'visor', hatColor: '#E8C230', top: '#E8C230', trim: '#C0392B', style: 'tank', shoes: '#B07848', extra: 'whistle', build: 1.15 },
    sunbather: { kind: 'lying', skin: '#D9A070', hair: '#3A2A1E', top: '#E04A5A', trim: '#3A8AC8', extra: 'sunglasses' },
    dog: { kind: 'dog', top: '#8A5A35', trim: '#F0E6D8' }
  };
  (function genAmbient() {
    var r = mulberry(1337);
    var SK = ['#F2D0B0', '#E8BC94', '#D9A57B', '#C68A5E', '#A86E48', '#8A5A3A', '#6A4028', '#F0C8A8'];
    var HA = ['#1A1410', '#3A2A1E', '#5A3A22', '#8A5A30', '#C9A060', '#E8D080', '#A8A8A8', '#2A2A2A', '#7A3020', '#D8D8D8'];
    var TO = ['#C0392B', '#2E5A8A', '#E8E0C8', '#F2F2F2', '#2A2A30', '#D98A3A', '#7A5A8A', '#3AA0C8', '#E07AA0', '#8A6A4A', '#5A6A7A', '#C8B040', '#A04060', '#406A8A', '#E8A060', '#F2D24A'];
    var ST = ['shirt', 'shirt', 'tank', 'hoodie', 'floral', 'flannel', 'shirt', 'cardigan', 'suit', 'jersey'];
    var HS = ['short', 'short', 'long', 'curly', 'ponytail', 'bald', 'slick', 'bun', 'long', 'short'];
    var HATS = [null, null, null, null, 'cap', 'beanie', 'bucket', 'headband', 'cap', null];
    var HC = ['#2E5A8A', '#C0392B', '#F2F2F2', '#2A2A30', '#D8C8A0', '#E8C230', '#7A5A8A'];
    var EX = [null, null, null, null, 'sunglasses', 'beard', 'chain', null, 'camera', null];
    var SH = ['#1E1E1E', '#F2F2F2', '#6A4A2A', '#3A6AC0', '#C0392B', '#3A3A40'];
    for (var i = 0; i < 24; i++) {
      var st = pick(r, ST), top = pick(r, TO);
      LOOKS['amb' + i] = {
        skin: pick(r, SK), hair: pick(r, HA), hairStyle: pick(r, HS), hat: pick(r, HATS), hatColor: pick(r, HC),
        top: top, trim: pick(r, TO), style: st, shoes: pick(r, SH), extra: pick(r, EX), build: 0.9 + r() * 0.25,
        sleeve: st === 'tank' ? null : undefined
      };
      if (LOOKS['amb' + i].hairStyle === 'bald' && !LOOKS['amb' + i].hat) LOOKS['amb' + i].extra = LOOKS['amb' + i].extra || null;
    }
  })();
  art.LOOKS = Object.keys(LOOKS);

  // ---------- canvas helpers (DOM only when called) ----------
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function hexRgb(h) { var n = parseInt(String(h).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function shade(h, f) { var c = hexRgb(h); return 'rgb(' + cl(c[0] * f) + ',' + cl(c[1] * f) + ',' + cl(c[2] * f) + ')'; }
  function circ(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  function ell(g, c, x, y, rx, ry) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); }
  function rect(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }

  // ---------- person painter (rotated frame: facing north = -y) ----------
  function paintHead(g, L) {
    var hy = -0.8, hat = L.hat, hc = L.hatColor || '#444444', hair = L.hair || '#2A2A2A', skin = L.skin || '#D9A57B';
    if (hat === 'hood') {
      circ(g, shade(hc, 0.8), 0, hy + 0.6, 4.7);
      circ(g, skin, 0, hy - 2.0, 2.2);
      circ(g, shade(hc, 0.95), 0, hy + 1.0, 3.7);
      return;
    }
    if (L.hairStyle === 'long') ell(g, hair, 0, hy + 2.4, 3.9, 4.6);
    circ(g, skin, 0, hy - 0.6, 3.7);
    switch (L.hairStyle) {
      case 'bald': circ(g, shade(skin, 1.12), 0.8, hy + 0.2, 1.2); break;
      case 'slick': circ(g, hair, 0, hy + 0.7, 3.5); rect(g, shade(hair, 1.4), -0.4, hy - 1.5, 0.8, 4); break;
      case 'curly': for (var k = 0; k < 7; k++) { var a = k / 7 * TAU; circ(g, hair, Math.cos(a) * 2.4, hy + 0.8 + Math.sin(a) * 2.4, 1.6); } circ(g, hair, 0, hy + 0.8, 2.4); break;
      case 'ponytail': circ(g, hair, 0, hy + 0.6, 3.5); circ(g, shade(hair, 0.85), 0, hy + 4.6, 1.7); break;
      case 'bun': circ(g, hair, 0, hy + 0.6, 3.5); circ(g, shade(hair, 0.88), 0, hy + 2.8, 1.9); break;
      case 'long': circ(g, hair, 0, hy + 0.5, 3.6); break;
      default: circ(g, hair, 0, hy + 0.6, 3.4);
    }
    switch (hat) {
      case 'fedora':
        circ(g, shade(hc, 1.35), 0, hy + 0.3, 5.0); circ(g, L.band || '#241A12', 0, hy + 0.3, 3.7); circ(g, hc, 0, hy + 0.5, 2.8);
        rect(g, shade(hc, 0.7), -0.4, hy - 2, 0.8, 4.6); break;
      case 'cap': circ(g, hc, 0, hy + 0.3, 3.6); ell(g, shade(hc, 0.8), 0, hy - 3.6, 2.9, 1.8); circ(g, shade(hc, 1.15), 0, hy + 0.3, 0.8); break;
      case 'hardhat': circ(g, shade(hc, 0.82), 0, hy + 0.2, 4.6); circ(g, hc, 0, hy + 0.1, 3.9); rect(g, shade(hc, 1.15), -0.7, hy - 3.6, 1.4, 7.4); break;
      case 'beanie': circ(g, shade(hc, 0.82), 0, hy + 0.4, 3.9); circ(g, hc, 0, hy + 0.6, 3.1); circ(g, shade(hc, 1.2), 0, hy + 0.8, 1.2); break;
      case 'bucket': circ(g, shade(hc, 0.82), 0, hy + 0.2, 5.2); circ(g, hc, 0, hy + 0.3, 3.5); break;
      case 'toque': circ(g, '#DCDCDC', 0, hy + 0.6, 4.7); circ(g, '#FFFFFF', 0, hy + 0.4, 3.9); circ(g, '#F0F0F0', -1.2, hy + 1.2, 1.6); circ(g, '#F0F0F0', 1.4, hy - 0.4, 1.4); break;
      case 'headband': g.strokeStyle = hc; g.lineWidth = 1.2; g.beginPath(); g.arc(0, hy + 0.4, 3.3, 0, TAU); g.stroke(); break;
      case 'visor': ell(g, hc, 0, hy - 3.2, 3.4, 2.0); g.strokeStyle = hc; g.lineWidth = 1; g.beginPath(); g.arc(0, hy + 0.4, 3.3, Math.PI, TAU); g.stroke(); break;
    }
    if (L.extra === 'sunglasses') rect(g, '#121216', -2.7, hy - 3.9, 5.4, 1.3);
    if (L.extra === 'beard') ell(g, shade(hair, 0.9), 0, hy - 3.4, 2.4, 1.3);
  }
  function paintPerson(g, L, dir, frame) {
    var skin = L.skin || '#D9A57B', top = L.top || '#777777', style = L.style || 'shirt', b = L.build || 1;
    var sleeve = L.sleeve || ((style === 'tank' || style === 'wetsuit' && false) ? skin : (L.bare ? skin : top));
    if (style === 'tank') sleeve = skin;
    var bw = 6.6 * b, s = frame === 1 ? 1 : frame === 2 ? -1 : 0, shoes = L.shoes || '#222222';
    ell(g, 'rgba(0,0,0,0.28)', 1.5, 2.5, 7.5, 5.5);
    g.save(); g.rotate(dir * Math.PI / 4);
    // feet
    ell(g, shoes, -2.5, s === 0 ? 0.6 : -4.4 * s, 1.6, 2.4);
    ell(g, shoes, 2.5, s === 0 ? 0.6 : 4.4 * s, 1.6, 2.4);
    // coat tails
    if (style === 'coat') ell(g, shade(top, 0.86), 0, 3.6, bw - 0.2, 5.4);
    else if (style === 'labcoat') ell(g, shade(top, 0.82), 0, 3.2, bw - 0.6, 4.4);
    // arms
    var ay = 3 * s;
    ell(g, shade(sleeve, 0.9), -bw + 0.6, ay, 2.1, 3.0); ell(g, shade(sleeve, 0.9), bw - 0.6, -ay, 2.1, 3.0);
    if (s !== 0) { circ(g, skin, -bw + 0.6, ay + 2.6 * s, 1.4); circ(g, skin, bw - 0.6, -ay - 2.6 * s, 1.4); }
    // body
    var bodyCol = (style === 'vest' || style === 'apron') ? (L.sleeve || '#5A6A7A') : top;
    ell(g, bodyCol, 0, 0.5, bw, 4.5);
    switch (style) {
      case 'coat': rect(g, L.trim || shade(top, 0.7), -bw + 1, 1.4, 2 * bw - 2, 1.1); ell(g, shade(top, 1.12), -2.2, -2.8, 1.6, 1.3); ell(g, shade(top, 1.12), 2.2, -2.8, 1.6, 1.3); break;
      case 'suit': ell(g, '#F2F2F2', 0, -3.2, 1.6, 1.2); rect(g, L.trim || '#B8343A', -0.5, -3.9, 1, 2.4); break;
      case 'tank': ell(g, shade(top, 0.85), 0, 1, bw - 2.2, 3.4); break;
      case 'hoodie': if (L.hat !== 'hood') ell(g, shade(top, 0.82), 0, 3.0, 3.4, 1.9); rect(g, shade(top, 1.25), -1.6, -3.4, 0.6, 2); rect(g, shade(top, 1.25), 1.0, -3.4, 0.6, 2); break;
      case 'vest': ell(g, top, 0, 0.5, bw - 0.8, 4.2); rect(g, L.trim || '#E8E8E8', -bw + 1.2, -1.2, 2 * bw - 2.4, 1); rect(g, L.trim || '#E8E8E8', -bw + 1.2, 1.6, 2 * bw - 2.4, 1); break;
      case 'jersey': rect(g, L.trim || '#FFFFFF', -bw + 0.6, -0.4, 2 * bw - 1.2, 0.9); rect(g, '#FFFFFF', -1.6, 1.5, 1, 2.2); rect(g, '#FFFFFF', 0.4, 1.5, 1.2, 2.2); break;
      case 'apron': ell(g, top, 0, -1.2, bw - 1.6, 3.1); rect(g, shade(top, 0.8), -bw + 1.4, 0.6, 2 * bw - 2.8, 0.7); break;
      case 'wetsuit': rect(g, L.trim || '#2E8A9A', -bw + 0.8, -1.2, 2 * bw - 1.6, 1); break;
      case 'flannel': for (var k = -2; k <= 2; k++) rect(g, L.trim || shade(top, 0.6), k * 2.4 - 0.3, -3.5, 0.6, 7.5); rect(g, L.trim || shade(top, 0.6), -bw + 1, 0.2, 2 * bw - 2, 0.6); break;
      case 'floral': for (var q = 0; q < 6; q++) circ(g, L.trim || '#F2E24A', -bw + 2 + (q % 3) * (bw - 2), -2 + (q >> 1) % 3 * 2.4 + (q & 1), 0.8); break;
      case 'cardigan': rect(g, shade(top, 0.75), -0.3, -3.8, 0.6, 7.6); circ(g, L.trim || '#E8D8A0', 0, -2.5, 0.5); circ(g, L.trim || '#E8D8A0', 0, -0.5, 0.5); break;
      case 'labcoat': rect(g, shade(top, 0.78), -0.3, -3.8, 0.6, 7.6); ell(g, shade(top, 0.9), -2.2, -2.9, 1.4, 1.1); ell(g, shade(top, 0.9), 2.2, -2.9, 1.4, 1.1); break;
      case 'chef': circ(g, L.trim || '#2A2A2A', -1.4, -2.6, 0.5); circ(g, L.trim || '#2A2A2A', 1.4, -2.6, 0.5); circ(g, L.trim || '#2A2A2A', -1.4, -0.8, 0.5); circ(g, L.trim || '#2A2A2A', 1.4, -0.8, 0.5); break;
      default: ell(g, shade(top, 1.15), 0, -3.4, 1.8, 0.9);
    }
    if (L.extra === 'chain') { g.strokeStyle = '#E8C040'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, -1.6, 2.4, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
    if (L.extra === 'lanyard') { g.strokeStyle = L.trim || '#3A6AC0'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, -1.8, 2.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); rect(g, '#F2F2F2', -0.9, -4.6, 1.8, 1.4); }
    if (L.extra === 'whistle') circ(g, '#E8E8E8', 1.2, -3.8, 0.8);
    if (L.extra === 'camera') rect(g, '#1E1E22', -1.6, -4.6, 3.2, 1.8);
    paintHead(g, L);
    g.restore();
  }
  function paintLying(g, L, dir, frame) {
    var skin = L.skin || '#D9A070', suit = L.top || '#E04A5A', towel = L.trim || '#3A8AC8';
    g.save(); g.rotate(dir * Math.PI / 4);
    rect(g, 'rgba(0,0,0,0.18)', -4, -10, 10, 21);
    rect(g, towel, -5, -10.5, 10, 21);
    for (var k = -9; k < 10; k += 4) rect(g, '#F2F2F2', -5, k, 10, 1.4);
    ell(g, skin, -1.8, 5.6, 1.6, 4.4); ell(g, skin, 1.8, 5.6, 1.6, 4.4);
    var arm = frame === 2 ? -1 : 0;
    ell(g, skin, -4.3, -1.2 + arm, 1.2, 3.6); ell(g, skin, 4.3, -1.2, 1.2, 3.6);
    ell(g, skin, 0, -1.8, 3.6, 4.4);
    rect(g, suit, -3.2, -4.6, 6.4, 2.2); rect(g, suit, -2.8, 1.2, 5.6, 2.2);
    circ(g, L.hair || '#3A2A1E', 0, -7.6, 3.1); circ(g, skin, 0, -7.0, 2.6);
    if (L.extra === 'sunglasses') rect(g, '#121216', -2.2, -7.6, 4.4, 1.1);
    g.restore();
  }
  function paintDog(g, L, dir, frame) {
    var c = L.top || '#8A5A35', p = L.trim || '#F0E6D8', s = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    ell(g, 'rgba(0,0,0,0.25)', 1, 2, 4.5, 6.5);
    g.save(); g.rotate(dir * Math.PI / 4);
    var dk = shade(c, 0.72);
    circ(g, dk, -2.3, -2.2 + 1.4 * s, 1.1); circ(g, dk, 2.3, -2.2 - 1.4 * s, 1.1);
    circ(g, dk, -2.3, 3.6 - 1.4 * s, 1.1); circ(g, dk, 2.3, 3.6 + 1.4 * s, 1.1);
    g.strokeStyle = c; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 5.4); g.lineTo(1.6 * (s || 0.6), 8.6); g.stroke();
    ell(g, c, 0, 1, 2.8, 5);
    ell(g, p, 0, 1.6, 1.4, 2.4);
    circ(g, c, 0, -4.8, 2.5);
    ell(g, shade(c, 0.85), 0, -7, 1.3, 1.6); circ(g, '#141414', 0, -8.2, 0.6);
    ell(g, shade(c, 0.6), -2, -4.4, 0.9, 1.6); ell(g, shade(c, 0.6), 2, -4.4, 0.9, 1.6);
    g.restore();
  }

  // ---------- props (32x32 cells, centre at 16,18 = person centre) ----------
  function paintProp(g, name) {
    switch (name) {
      case 'envelope': g.save(); g.translate(5.5, -6.5); rect(g, '#F4F0E6', -3, -2, 6, 4); g.strokeStyle = '#A8A090'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-3, -2); g.lineTo(0, 0.4); g.lineTo(3, -2); g.stroke(); circ(g, '#B8343A', 0, 0.4, 0.6); g.restore(); break;
      case 'package': g.save(); g.translate(5.5, -6.5); rect(g, '#A87A48', -2.6, -2.6, 5.2, 5.2); rect(g, '#D8C090', -2.6, -0.4, 5.2, 0.8); rect(g, '#D8C090', -0.4, -2.6, 0.8, 5.2); g.restore(); break;
      case 'phone': g.save(); g.translate(2.6, -8.2); rect(g, '#16161A', -1.4, -2.1, 2.8, 4.2); rect(g, '#9AC8F0', -1, -1.7, 2, 3.2); g.restore(); break;
      case 'sign':
        g.strokeStyle = '#6A4A2A'; g.lineWidth = 1; g.beginPath(); g.moveTo(5, -6); g.lineTo(1, -9); g.stroke();
        rect(g, '#6A4A2A', -7.4, -14.4, 14.8, 6.8); rect(g, '#F2EDE0', -7, -14, 14, 6);
        rect(g, '#C0392B', -5.5, -12.6, 11, 1.2); rect(g, '#C0392B', -4.5, -10.4, 8, 1.2); break;
      case 'cards': g.save(); g.translate(5.5, -6.5); for (var k = -1; k <= 1; k++) { g.save(); g.rotate(k * 0.35); rect(g, '#8A8A8A', -1.3, -3.1, 2.6, 3.8); rect(g, '#FAFAFA', -1.1, -2.9, 2.2, 3.4); circ(g, '#C0302A', 0, -1.2, 0.5); g.restore(); } g.restore(); break;
      case 'cash': g.save(); g.translate(5.5, -6.5); rect(g, '#5A86B8', -2.6, -1.4, 5.4, 3); rect(g, '#D98A3A', -3.2, -2.2, 5.4, 3); rect(g, '#F2C88A', -1.4, -1.4, 1.8, 1.4); g.restore(); break;
      case 'trashbag': g.save(); g.translate(7.4, 1.2); ell(g, '#1C1C20', 0, 0, 3.6, 4.2); circ(g, '#3A3A44', -1.2, -1.2, 1.2); rect(g, '#2A2A30', -0.8, -5, 1.6, 1.6); g.restore(); break;
      case 'clipboard': g.save(); g.translate(5.5, -6.5); rect(g, '#8A5A30', -2.6, -3.6, 5.2, 7.2); rect(g, '#F2F2EE', -2.1, -2.9, 4.2, 5.8); rect(g, '#9A9A9A', -1.6, -1.6, 3.2, 0.5); rect(g, '#9A9A9A', -1.6, 0, 3.2, 0.5); rect(g, '#C8C8C8', -1, -4, 2, 1.2); g.restore(); break;
      case 'paddle': g.save(); g.translate(6.2, -5.4); rect(g, '#7A5A34', -0.6, 1.6, 1.2, 3.2); circ(g, '#9A6E3A', 0, -1, 3.6); circ(g, '#C89A5A', 0, -1, 3); g.restore(); break;
      case 'coffee': g.save(); g.translate(5.5, -6.5); circ(g, '#D8D2C6', 0, 0, 2); circ(g, '#F2F0EA', 0, 0, 1.7); circ(g, '#6A4028', 0, 0, 1.2); g.restore(); break;
    }
  }

  // ---------- glow silhouette ----------
  function silhouette(g, sc) {
    g.beginPath(); g.ellipse(0, 0.5, 8.4 * sc, 5.6 * sc, 0, 0, TAU); g.fill();
    g.beginPath(); g.arc(0, -0.8, 4.6 * sc, 0, TAU); g.fill();
    g.beginPath(); g.arc(-7 * sc, 0, 3 * sc, 0, TAU); g.arc(7 * sc, 0, 3 * sc, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(0, 3 * sc, 5 * sc, 6 * sc, 0, 0, TAU); g.fill();
  }
  function paintGlowCell(g, cx, cy, dir, color, blur, sc, passes, fillA) {
    var SH = 4000;
    g.save();
    g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetX = SH; g.shadowOffsetY = 0;
    g.fillStyle = color;
    for (var p = 0; p < passes; p++) {
      g.save(); g.translate(cx - SH, cy); g.rotate(dir * Math.PI / 4); silhouette(g, sc); g.restore();
    }
    g.restore();
    if (fillA > 0) {
      g.save(); g.globalAlpha = fillA; g.fillStyle = color; g.translate(cx, cy); g.rotate(dir * Math.PI / 4); silhouette(g, sc * 1.05); g.restore();
    }
  }

  // ---------- icons 16x16 ----------
  function paintIcon(g, name) {
    switch (name) {
      case 'ball': circ(g, '#A84A18', 8, 8, 4.6); circ(g, '#FF7A30', 8, 8, 4); circ(g, '#FFD0A0', 6.6, 6.6, 1.3); break;
      case 'heart':
        g.fillStyle = '#B8203A'; g.beginPath(); g.arc(5.3, 6, 3.6, 0, TAU); g.arc(10.7, 6, 3.6, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(1.8, 7); g.lineTo(8, 14.2); g.lineTo(14.2, 7); g.fill();
        g.fillStyle = '#FF4A7A'; g.beginPath(); g.arc(5.3, 6, 2.8, 0, TAU); g.arc(10.7, 6, 2.8, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(2.8, 7); g.lineTo(8, 13); g.lineTo(13.2, 7); g.fill(); circ(g, '#FFC0D0', 4.6, 5, 1); break;
      case 'cash': rect(g, '#8A5420', 1, 4, 14, 8); rect(g, '#D98A3A', 2, 5, 12, 6); circ(g, '#F2C88A', 8, 8, 2.2); rect(g, '#F2C88A', 3, 6, 2, 1); rect(g, '#F2C88A', 11, 9, 2, 1); rect(g, '#5A86B8', 3, 2, 12, 2); break;
      case 'pill':
        g.save(); g.translate(8, 8); g.rotate(-Math.PI / 4);
        rect(g, '#7A2A2A', -6, -3, 12, 6); circ(g, '#E04A4A', -3, 0, 2.6); rect(g, '#E04A4A', -3, -2.6, 3, 5.2);
        circ(g, '#F2F2F2', 3, 0, 2.6); rect(g, '#F2F2F2', 0, -2.6, 3, 5.2); rect(g, '#FFFFFF', -4, -1.6, 6, 0.8); g.restore(); break;
      case 'envelope': rect(g, '#8A8070', 1, 3, 14, 10); rect(g, '#F4F0E6', 2, 4, 12, 8); g.strokeStyle = '#A8A090'; g.lineWidth = 1; g.beginPath(); g.moveTo(2, 4); g.lineTo(8, 9); g.lineTo(14, 4); g.stroke(); circ(g, '#B8343A', 8, 9, 1.3); break;
      case 'bang': circ(g, '#7A2A10', 8, 8, 7.2); circ(g, '#F25A2A', 8, 8, 6.4); rect(g, '#FFFFFF', 7, 3, 2, 6.5); rect(g, '#FFFFFF', 7, 10.6, 2, 2); break;
      case 'question':
        circ(g, '#1E3A70', 8, 8, 7.2); circ(g, '#3A6AC0', 8, 8, 6.4);
        g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.arc(8, 6, 2.6, Math.PI * 1.1, Math.PI * 2.4); g.lineTo(8, 9.6); g.stroke(); rect(g, '#FFFFFF', 7, 11, 2, 2); break;
      case 'camera': rect(g, '#141418', 1, 4, 14, 10); rect(g, '#2A2A30', 2, 5, 12, 8); rect(g, '#2A2A30', 4, 2, 5, 3); rect(g, '#E8E8E8', 11, 6, 2, 1.4);
        circ(g, '#6A7A8A', 8, 9, 3.4); circ(g, '#1A1A20', 8, 9, 2.2); circ(g, '#A8C8E8', 7.2, 8.2, 0.7); break;
    }
  }

  // ---------- vehicles ----------
  var VCELL = { car: 64, scooter: 32 };
  function paintCar(g, col, dir) {
    var dk = shade(col, 0.7), lt = shade(col, 1.2);
    g.save(); g.translate(3, 3); g.rotate(dir * Math.PI / 4); rect(g, 'rgba(0,0,0,0.3)', -11, -23, 22, 46); g.restore();
    g.save(); g.rotate(dir * Math.PI / 4);
    rect(g, '#141414', -12, -16, 2, 7); rect(g, '#141414', 10, -16, 2, 7); rect(g, '#141414', -12, 10, 2, 7); rect(g, '#141414', 10, 10, 2, 7);
    rect(g, dk, -11, -23, 22, 46); rect(g, col, -10, -22, 20, 44);
    rect(g, lt, -9, -21, 18, 2);
    rect(g, '#2E3A48', -8, -12, 16, 6); rect(g, '#4A5A6E', -7, -11, 6, 1);
    rect(g, shade(col, 0.88), -8, -6, 16, 13);
    rect(g, '#2E3A48', -8, 7, 16, 4);
    rect(g, '#2E3A48', -10, -5, 1, 10); rect(g, '#2E3A48', 9, -5, 1, 10);
    rect(g, '#F2F0C8', -9, -23, 4, 2); rect(g, '#F2F0C8', 5, -23, 4, 2);
    rect(g, '#C0302A', -9, 21, 4, 2); rect(g, '#C0302A', 5, 21, 4, 2);
    rect(g, dk, -12, -9, 1, 2); rect(g, dk, 11, -9, 1, 2);
    g.restore();
  }
  function paintScooter(g, col, dir) {
    g.save(); g.translate(2, 2); g.rotate(dir * Math.PI / 4); ell(g, 'rgba(0,0,0,0.28)', 0, 0, 5, 9); g.restore();
    g.save(); g.rotate(dir * Math.PI / 4);
    rect(g, '#141414', -1, -10, 2, 3); rect(g, '#141414', -1, 7, 2, 3);
    rect(g, '#2A2A2E', -2, -8, 4, 16); rect(g, col, -2, -2, 4, 2);
    rect(g, '#5A5A60', -5, -9, 10, 1.4);
    ell(g, shade(col, 0.9), -4.2, -3.5, 1.5, 2.6); ell(g, shade(col, 0.9), 4.2, -3.5, 1.5, 2.6);
    circ(g, '#D9A57B', -4.6, -7.4, 1.2); circ(g, '#D9A57B', 4.6, -7.4, 1.2);
    ell(g, col, 0, 0, 5, 3.2);
    circ(g, '#E0B080', 0, -0.8, 2.6); circ(g, '#2A2A2E', 0, -0.2, 2.6); circ(g, '#4A4A52', -0.6, -0.8, 0.8);
    g.restore();
  }

  // ---------- 1 px dark outline, baked per cell (init only) ----------
  var OUT_R = 22, OUT_G = 16, OUT_B = 26, OUT_A = 235;
  function outlineCells(c, cw, chh) {
    var g = c.getContext('2d'), img = null;
    try { img = g.getImageData(0, 0, c.width, c.height); } catch (e) { img = null; }
    if (!img || !img.data || !img.data.length) return;
    var W = c.width, H = c.height, src = img.data, a = new Uint8Array(W * H), i, x, y;
    for (i = 0; i < W * H; i++) a[i] = src[i * 4 + 3];
    for (y = 0; y < H; y++) {
      var y0 = y - (y % chh), y1 = y0 + chh - 1;
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (a[i] >= 110) continue;
        var x0 = x - (x % cw), x1 = x0 + cw - 1;
        if ((x > x0 && a[i - 1] >= 160) || (x < x1 && a[i + 1] >= 160) || (y > y0 && a[i - W] >= 160) || (y < y1 && a[i + W] >= 160)) {
          src[i * 4] = OUT_R; src[i * 4 + 1] = OUT_G; src[i * 4 + 2] = OUT_B; src[i * 4 + 3] = OUT_A;
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  // ---------- caches ----------
  var cache = null;
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  art.init = function () {
    if (typeof document === 'undefined') return false;
    var t0 = now(), names = Object.keys(LOOKS), i, d, f, g, c;
    cache = { lookAtlas: null, lookOff: null, propAtlas: null, props: Object.create(null), glow: null, core: null, icons: null, iconIdx: Object.create(null), veh: Object.create(null), vehKeys: [], fx: {} };
    // one atlas for all looks (8 looks per row, each 3 frames x 8 dirs) -> a single outline readback
    var PER = 8, rows = Math.ceil(names.length / PER);
    c = mk(CELL * 3 * PER, CELL * 8 * rows); g = c.getContext('2d');
    cache.lookAtlas = c; cache.lookOff = Object.create(null);
    for (i = 0; i < names.length; i++) {
      var L = LOOKS[names[i]], ox = (i % PER) * CELL * 3, oy = Math.floor(i / PER) * CELL * 8;
      cache.lookOff[names[i]] = [ox, oy];
      for (d = 0; d < 8; d++) for (f = 0; f < 3; f++) {
        g.save(); g.translate(ox + f * CELL + 12, oy + d * CELL + 12);
        if (L.kind === 'dog') paintDog(g, L, d, f);
        else if (L.kind === 'lying') paintLying(g, L, d, f);
        else paintPerson(g, L, d, f);
        g.restore();
      }
    }
    outlineCells(c, CELL, CELL);
    c = mk(PCELL * 8, PCELL * PROPS.length); g = c.getContext('2d'); cache.propAtlas = c;
    for (i = 1; i < PROPS.length; i++) {
      for (d = 0; d < 8; d++) { g.save(); g.translate(d * PCELL + 16, i * PCELL + 18); g.rotate(d * Math.PI / 4); paintProp(g, PROPS[i]); g.restore(); }
      cache.props[PROPS[i]] = i * PCELL;
    }
    outlineCells(c, PCELL, PCELL);
    cache.glow = mk(GCELL * 8, GCELL); g = cache.glow.getContext('2d');
    for (d = 0; d < 8; d++) paintGlowCell(g, d * GCELL + 24, 26, d, GLOW, 5, 0.95, 3, 0.45);
    cache.core = mk(GCELL * 8, GCELL); g = cache.core.getContext('2d');
    for (d = 0; d < 8; d++) paintGlowCell(g, d * GCELL + 24, 26, d, '#FFFFFF', 3, 1.0, 3, 0);
    cache.icons = mk(ICELL * ICONS.length, ICELL); g = cache.icons.getContext('2d');
    for (i = 0; i < ICONS.length; i++) { g.save(); g.translate(i * ICELL, 0); paintIcon(g, ICONS[i]); g.restore(); cache.iconIdx[ICONS[i]] = i; }
    // fx sprites
    var sp = mk(9, 9); g = sp.getContext('2d');
    rect(g, '#FFF6C0', 4, 0, 1, 9); rect(g, '#FFF6C0', 0, 4, 9, 1); rect(g, '#FFFFFF', 3, 3, 3, 3); cache.fx.sparkle = sp;
    var fl = mk(28, 28); g = fl.getContext('2d');
    for (i = 0; i < 8; i++) { g.save(); g.translate(14, 14); g.rotate(i * Math.PI / 4); rect(g, i & 1 ? 'rgba(255,255,240,0.7)' : '#FFFFFF', -1, -13, 2, 10); g.restore(); }
    circ(g, '#FFFFFF', 14, 14, 5); cache.fx.flash = fl;
    cache.fx.arcs = [];
    for (i = 0; i < 6; i++) {
      var r = 7 + i * 3, ac = mk(64, 40); g = ac.getContext('2d');
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 2;
      g.beginPath(); g.arc(32, 20, r, -0.6, 0.6); g.stroke();
      g.beginPath(); g.arc(32, 20, r, Math.PI - 0.6, Math.PI + 0.6); g.stroke();
      cache.fx.arcs.push(ac);
    }
    var ml = mk(6, 12); g = ml.getContext('2d'); rect(g, '#FFFFFF', 2, 0, 2, 3); rect(g, '#FFFFFF', 0, 4, 2, 4); rect(g, '#FFFFFF', 2, 9, 2, 3); cache.fx.motion = ml;
    // player marker: soft pale-yellow ellipse 20x10 core, feathered edge (pre-rendered)
    var pm = mk(28, 16); g = pm.getContext('2d');
    for (i = 0; i < 6; i++) { g.globalAlpha = 0.22; ell(g, '#FFF2A0', 14, 8, 13 - i * 1.6, 7 - i * 0.8); }
    g.globalAlpha = 1; cache.fx.marker = pm;
    // flash disc: solid white r 42 with a feathered edge to r 54 (pre-rendered)
    var dc = mk(110, 110), dg = dc.getContext('2d');
    for (i = 0; i < 6; i++) { dg.globalAlpha = 0.18; circ(dg, '#FFFFFF', 55, 55, 54 - i * 2); }
    dg.globalAlpha = 1; circ(dg, '#FFFFFF', 55, 55, 42); cache.fx.disc = dc;
    art.ready = true;
    art.initMs = Math.round(now() - t0);
    return true;
  };
  function ensure() { if (cache) return true; if (typeof document === 'undefined') return false; return art.init(); }

  var WALK = [1, 0, 2, 0];
  function lookOff(look) {
    var o = (typeof look === 'string') ? cache.lookOff[look] : null;
    if (o) return o;
    if (typeof look === 'string' && look.slice(0, 3) === 'amb') { var n = parseInt(look.slice(3), 10); if (n >= 0) return cache.lookOff['amb' + (n % 24)] || cache.lookOff.amb0; }
    return cache.lookOff.amb0;
  }
  function dirOf(dir) { dir = dir | 0; return ((dir % 8) + 8) % 8; }

  art.drawCharacter = function (ctx, sx, sy, look, dir, animT, moving, prop) {
    if (!ensure()) return;
    var d = dirOf(dir), fr = moving ? WALK[Math.floor((+animT || 0) * 8) & 3] : 0;
    var x = Math.round(sx), y = Math.round(sy);
    var o = lookOff(look);
    ctx.drawImage(cache.lookAtlas, o[0] + fr * CELL, o[1] + d * CELL, CELL, CELL, x - 12, y - 14, CELL, CELL);
    if (prop && prop !== 'none' && typeof prop === 'string') {
      var py = cache.props[prop];
      if (py) ctx.drawImage(cache.propAtlas, d * PCELL, py, PCELL, PCELL, x - 16, y - 20, PCELL, PCELL);
    }
  };

  art.drawGlow = function (ctx, sx, sy, dir, intensity, timeSec) {
    if (!ensure()) return;
    var I = +intensity;
    if (!(I > 0)) return;
    if (I > 1) I = 1;
    var fq = 0.8 + 3.2 * I, p = ((+timeSec || 0) * fq) % 1;
    if (p < 0) p += 1;
    var a1 = (p - 0.08) / 0.06, a2 = (p - 0.32) / 0.07;
    var hb = Math.exp(-a1 * a1) + 0.6 * Math.exp(-a2 * a2);
    if (hb > 1) hb = 1;
    var pulse = 1 + 0.15 * (2 * hb - 1);
    var s = (0.8 + 0.4 * I) * pulse, w = Math.round(GCELL * s), d = dirOf(dir);
    var x = Math.round(sx), y = Math.round(sy) - 2, prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * I;
    ctx.drawImage(cache.glow, d * GCELL, 0, GCELL, GCELL, x - (w >> 1), y - (w >> 1), w, w);
    var core = (I - 0.93) / 0.07;   // white rim only ~0.4 s around the peak
    if (core > 0) {
      ctx.globalAlpha = prev * (core > 1 ? 1 : core);
      ctx.drawImage(cache.core, d * GCELL, 0, GCELL, GCELL, x - (w >> 1), y - (w >> 1), w, w);
    }
    ctx.globalAlpha = prev;
  };

  art.drawGroundRing = function (ctx, sx, sy, rx, ry, intensity) {
    var I = +intensity;
    if (!(I > 0)) return;
    if (I > 1) I = 1;
    var pa = ctx.globalAlpha, pw = ctx.lineWidth, ps = ctx.strokeStyle;
    ctx.globalAlpha = pa * (0.25 + 0.6 * I);
    ctx.strokeStyle = GLOW; ctx.lineWidth = 2 + 3 * I;
    ctx.beginPath(); ctx.ellipse(Math.round(sx), Math.round(sy), Math.max(1, +rx || 1), Math.max(1, +ry || 1), 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = pa; ctx.lineWidth = pw; ctx.strokeStyle = ps;
  };

  // peak cue (drawn above people): k 0..1 over PEAK_FLARE_TIME. cutoff = CFG.PEAK_FLASH_TIME / PEAK_FLARE_TIME
  // (read per call; 0.16 if missing/invalid). k < cutoff: pre-rendered white disc (r 42, feathered to 54),
  // alpha 0.7 held for the first half of the cutoff, then -> 0 at the cutoff; throughout: 6 px white ring
  // r 20 -> 80, alpha 1 -> 0 (one arc per frame).
  art.drawPeakFlare = function (ctx, sx, sy, k) {
    var p = +k;
    if (!(p >= 0 && p < 1)) return;
    if (!ensure()) return;
    var x = Math.round(sx), y = Math.round(sy);
    if (!(x === x && y === y)) return;
    var pa = ctx.globalAlpha, pw = ctx.lineWidth, ps = ctx.strokeStyle;
    var cf = PE.CFG, cut = cf ? (+cf.PEAK_FLASH_TIME) / (+cf.PEAK_FLARE_TIME) : NaN;
    if (!(cut > 0 && cut <= 1)) cut = 0.16;
    if (p < cut) {
      var half = cut / 2;
      ctx.globalAlpha = pa * 0.7 * (p < half ? 1 : (cut - p) / half);
      ctx.drawImage(cache.fx.disc, x - 55, y - 55);
    }
    ctx.globalAlpha = pa * (1 - p);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(x, y, 20 + 60 * p, 0, TAU); ctx.stroke();
    ctx.globalAlpha = pa; ctx.lineWidth = pw; ctx.strokeStyle = ps;
  };

  // soft pale-yellow ground ellipse under the player (alpha 0.55), gentle 0.9 Hz pulse
  art.drawPlayerMarker = function (ctx, sx, sy, timeSec) {
    if (!ensure()) return;
    var ph = Math.sin((+timeSec || 0) * 5.65);
    var w = Math.round(28 * (1 + 0.06 * ph)), h = Math.round(16 * (1 + 0.06 * ph)), pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (0.55 + 0.07 * ph);
    ctx.drawImage(cache.fx.marker, Math.round(sx) - (w >> 1), Math.round(sy) + 1 - (h >> 1), w, h);
    ctx.globalAlpha = pa;
  };

  function icon(ctx, name, x, y, w) {
    var i = cache.iconIdx[name];
    if (i === undefined) return;
    ctx.drawImage(cache.icons, i * ICELL, 0, ICELL, ICELL, Math.round(x - w / 2), Math.round(y - w / 2), w, w);
  }
  art.drawIcon = function (ctx, name, sx, sy, scale) {
    if (!ensure()) return;
    var sc = +scale; if (!(sc > 0)) sc = 1;
    icon(ctx, name, sx, sy, Math.max(1, Math.round(ICELL * sc)));
  };

  art.drawActionFx = function (ctx, sx, sy, action, t) {
    if (!ensure()) return;
    var tt = +t || 0, x = Math.round(sx), y = Math.round(sy), pa = ctx.globalAlpha, i, p, k;
    switch (action) {
      case 'kiss':
        for (i = 0; i < 3; i++) {
          p = (tt * 0.9 + i / 3) % 1;
          ctx.globalAlpha = pa * (1 - p);
          icon(ctx, 'heart', x + Math.round(Math.sin(p * 6.28 + i * 2) * 6), y - 26 - Math.round(p * 18), 10 + (i === 1 ? 2 : 0));
        }
        break;
      case 'deal':
        k = tt * 3;
        icon(ctx, 'pill', x + Math.round(Math.cos(k) * 8), y - 22 + Math.round(Math.sin(k) * 3), 10);
        icon(ctx, 'cash', x - Math.round(Math.cos(k) * 8), y - 22 - Math.round(Math.sin(k) * 3), 10);
        if ((tt * 4 % 1) < 0.5) ctx.drawImage(cache.fx.sparkle, x + 6, y - 34);
        break;
      case 'handoff':
        icon(ctx, 'envelope', x, y - 26 + Math.round(Math.sin(tt * 5) * 2), 14);
        for (i = 0; i < 4; i++) {
          k = tt * 2 + i * Math.PI / 2;
          ctx.globalAlpha = pa * (0.5 + 0.5 * Math.sin(tt * 9 + i * 1.7));
          ctx.drawImage(cache.fx.sparkle, x - 4 + Math.round(Math.cos(k) * 13), y - 30 + Math.round(Math.sin(k) * 7));
        }
        break;
      case 'pose':
        p = tt % 0.7;
        if (p < 0.14) { ctx.globalAlpha = pa * (1 - p / 0.14); ctx.drawImage(cache.fx.flash, x - 6, y - 36); }
        ctx.globalAlpha = pa * 0.8;
        if ((tt * 3 % 1) < 0.5) ctx.drawImage(cache.fx.sparkle, x - 14, y - 26); else ctx.drawImage(cache.fx.sparkle, x + 10, y - 30);
        break;
      case 'shout':
        for (i = 0; i < 3; i++) {
          p = (tt * 1.5 + i / 3) % 1;
          ctx.globalAlpha = pa * (1 - p);
          ctx.drawImage(cache.fx.arcs[Math.min(5, Math.floor(p * 6))], x - 32, y - 34);
        }
        ctx.globalAlpha = pa; icon(ctx, 'bang', x, y - 34, 12);
        break;
      case 'shake':
        k = Math.round(Math.sin(tt * 30) * 2);
        ctx.drawImage(cache.fx.motion, x - 16 + k, y - 18); ctx.drawImage(cache.fx.motion, x + 10 - k, y - 18);
        if ((tt * 3 % 1) < 0.5) ctx.drawImage(cache.fx.sparkle, x - 4, y - 32);
        icon(ctx, 'cash', x, y - 26, 10);
        break;
    }
    ctx.globalAlpha = pa;
  };

  function vehAtlas(type, color) {
    var key = type + color, c = cache.veh[key];
    if (c) return c;
    if (cache.vehKeys.length >= 48) { delete cache.veh[cache.vehKeys.shift()]; }
    var cs = VCELL[type], g;
    c = mk(cs * 8, cs); g = c.getContext('2d');
    for (var d = 0; d < 8; d++) {
      g.save(); g.translate(d * cs + cs / 2, cs / 2);
      if (type === 'car') paintCar(g, color, d); else paintScooter(g, color, d);
      g.restore();
    }
    cache.veh[key] = c; cache.vehKeys.push(key);
    return c;
  }
  // colour validity cached per colour string (capped), so no regex runs per frame
  var colorMemo = new Map();
  function colorOk(c) {
    if (typeof c !== 'string') return false;
    var v = colorMemo.get(c);
    if (v === undefined) {
      if (colorMemo.size >= 200) colorMemo.clear();
      v = /^#[0-9a-fA-F]{6}$/.test(c);
      colorMemo.set(c, v);
    }
    return v;
  }
  art.drawVehicle = function (ctx, sx, sy, type, dir, color) {
    if (!ensure()) return;
    var ty = type === 'scooter' ? 'scooter' : 'car';
    var col = colorOk(color) ? color : (ty === 'car' ? '#C0392B' : '#3A6AC0');
    var cs = VCELL[ty], d = dirOf(dir);
    ctx.drawImage(vehAtlas(ty, col), d * cs, 0, cs, cs, Math.round(sx) - (cs >> 1), Math.round(sy) - (cs >> 1), cs, cs);
  };
})(globalThis.PE = globalThis.PE || {});
