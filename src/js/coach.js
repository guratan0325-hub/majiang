
'use strict';

// 電脳麻将・無料の牌効率コーチ v2
(function () {
  const suits = { m: '萬', p: '筒', s: '索' };
  const honors = ['', '東', '南', '西', '北', '白', '發', '中'];
  const name = p => p[0] === 'z'
    ? honors[Number(p[1])]
    : (p[1] === '0' ? '赤5' : p[1]) + suits[p[0]];
  const normal = p => p[0] + (p[1] === '0' ? '5' : p[1]);

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:12px;right:8px;z-index:99999;' +
    'max-width:82vw;padding:10px 12px;border-radius:12px;' +
    'background:#102b27;color:white;font:13px/1.5 sans-serif;' +
    'box-shadow:0 3px 14px #0008;white-space:pre-line;' +
    'pointer-events:none;display:none';

  let previous = '';
  let marks = [];
  function unmark() {
    for (const m of marks) {
      m.el.style.outline = m.outline;
      m.el.style.outlineOffset = m.offset;
    }
    marks = [];
  }
  function hide() {
    if (previous) unmark();
    previous = '';
    panel.style.display = 'none';
  }

  function analyze(tiles, cut) {
    const rest = tiles.slice();
    const index = rest.indexOf(cut);
    if (index < 0) return null;
    rest.splice(index, 1);

    const str = ['m', 'p', 's', 'z']
      .map(s => s + rest.filter(p => p[0] === s)
        .map(p => p[1]).join('')).join('');
    const hand = Majiang.Shoupai.fromString(str);
    const shanten = Majiang.Util.xiangting(hand);
    const types = [...new Set(
      (Majiang.Util.tingpai(hand) || []).map(normal)
    )];

    // 自分の手牌のみから計算した理論上限
    const upper = types.reduce((n, p) => n + Math.max(0,
      4 - tiles.filter(t => normal(t) === p).length), 0);
    return { cut, shanten, types, upper };
  }

  function update() {
    if (!document.body) return;
    if (!panel.isConnected) document.body.appendChild(panel);

    const hand = [...document.querySelectorAll('.shoupai.main .bingpai')]
      .find(el => el.querySelector('.pai[role="button"]'));
    if (!hand || !window.Majiang || !Majiang.Util) return hide();

    const elements = [...hand.querySelectorAll('.pai[data-pai]')];
    const tiles = elements.map(el => el.dataset.pai);
    const choices = [...hand.querySelectorAll(
      '.pai[role="button"][data-pai]')].map(el => el.dataset.pai);

    // まずは鳴いていない14枚のツモ番に対応
    if (tiles.length !== 14 || !choices.length ||
        tiles.some(p => !/^(?:[mps][0-9]|z[1-7])$/.test(p))) {
      return hide();
    }

    const key = tiles.join('/') + '|' + choices.join('/');
    if (key === previous) return;
    previous = key;
    unmark();

    try {
      const ranks = [...new Set(choices)]
        .map(p => analyze(tiles, p)).filter(Boolean)
        .sort((a, b) => a.shanten - b.shanten ||
          b.upper - a.upper ||
          b.types.length - a.types.length ||
          Number(a.cut[1] === '0') - Number(b.cut[1] === '0'));
      if (!ranks.length) return hide();
      const best = ranks[0], second = ranks[1];

      marks = elements.filter(el => el.dataset.pai === best.cut)
        .map(el => ({ el, outline: el.style.outline,
          offset: el.style.outlineOffset }));
      for (const mark of marks) {
        mark.el.style.outline = '3px solid #ffd54a';
        mark.el.style.outlineOffset = '-2px';
      }

      const step = n => n === 0 ? 'テンパイ' : n + 'シャンテン';
      let why = 'この局面の牌効率評価では第一候補です。';
      if (second) {
        if (second.shanten > best.shanten) {
          why = '次点よりシャンテン数を小さくできます。';
        } else if (best.upper > second.upper) {
          why = '次点と同じシャンテン数で、受け入れ上限が' +
            (best.upper - second.upper) + '枚多いためです。';
        } else if (best.types.length > second.types.length) {
          why = '次点より有効牌の種類が多いためです。';
        } else {
          why = '上位2候補は牌効率ではほぼ同等です。';
        }
      }

      const useful = best.types.slice(0, 6).map(name).join('・');
      panel.textContent =
        '🀄 推奨：' + name(best.cut) + 'を切る\n' +
        (second ? '次点：' + name(second.cut) + 'を切る\n' : '') +
        step(best.shanten) + '／有効牌' + best.types.length +
        '種類／受け入れ上限' + best.upper + '枚\n' +
        (useful ? '有効牌例：' + useful + '\n' : '') +
        '理由：' + why + '\n' +
        '※上限枚数は他家の捨て牌・副露を未考慮。守備・打点も未評価。';
      panel.style.display = 'block';
    } catch (e) {
      console.warn('Coach v2:', e);
      hide();
    }
  }

  const start = () => setInterval(update, 450);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
})();
