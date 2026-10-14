
'use strict';

// 無料版・麻雀牌効率コーチ
(function () {
  const names = { m: '萬', p: '筒', s: '索' };
  const honors = ['', '東', '南', '西', '北',
                  '白', '發', '中'];

  function label(p) {
    if (p[0] === 'z') return honors[+p[1]];
    return (p[1] === '0' ? '赤5' : p[1])
      + names[p[0]];
  }

  let last = '';
  let marked = [];

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:8px;top:12px;' +
    'z-index:99999;max-width:72vw;' +
    'padding:10px 12px;border-radius:12px;' +
    'background:#102b27;color:white;' +
    'font:13px/1.5 sans-serif;' +
    'box-shadow:0 3px 14px #0008;' +
    'white-space:pre-line;pointer-events:none;' +
    'display:none';

  function reset() {
    for (const el of marked) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
    marked = [];
  }

  function update() {
    if (!panel.isConnected) {
      document.body.appendChild(panel);
    }

    const hands = [
      ...document.querySelectorAll(
        '.shoupai.main .bingpai'
      )
    ];

    const hand = hands.find(el =>
      el.querySelector('.pai[role="button"]')
    );

    if (!hand || !window.Majiang ||
        !Majiang.Util) {
      if (last) reset();
      last = '';
      panel.style.display = 'none';
      return;
    }

    const elements = [
      ...hand.querySelectorAll('.pai[data-pai]')
    ];
    const tiles = elements.map(el => el.dataset.pai);
    const allowed = [
      ...hand.querySelectorAll(
        '.pai[role="button"][data-pai]'
      )
    ].map(el => el.dataset.pai);

    // 初期版は鳴いていない14枚形に対応
    if (tiles.length !== 14 ||
        tiles.some(p =>
          !/^(?:[mps][0-9]|z[1-7])$/.test(p)
        ) || !allowed.length) {
      if (last) reset();
      last = '';
      panel.style.display = 'none';
      return;
    }

    const key = tiles.join('/') + '|'
              + allowed.join('/');

    if (key === last) return;
    last = key;
    reset();

    try {
      const candidates = [...new Set(allowed)];

      const results = candidates.map(discard => {
        const remain = tiles.slice();
        remain.splice(remain.indexOf(discard), 1);

        const str = ['m', 'p', 's', 'z']
          .map(s => s + remain
            .filter(p => p[0] === s)
            .map(p => p[1]).join(''))
          .join('');

        const state =
          Majiang.Shoupai.fromString(str);

        const shanten =
          Majiang.Util.xiangting(state);

        const improves =
          Majiang.Util.tingpai(state) || [];

        const approx = improves.reduce((n, p) => {
          const count = remain.filter(x =>
            x[0] === p[0] &&
            (x[1] === p[1] ||
             (p[1] === '5' && x[1] === '0'))
          ).length;
          return n + Math.max(0, 4 - count);
        }, 0);

        return {
          discard,
          shanten,
          count: improves.length,
          approx
        };
      });

      results.sort((a, b) =>
        a.shanten - b.shanten ||
        b.approx - a.approx ||
        b.count - a.count
      );

      const best = results[0];

      marked = elements.filter(el =>
        el.dataset.pai === best.discard
      );

      for (const el of marked) {
        el.style.outline = '3px solid #ffd54a';
        el.style.outlineOffset = '-2px';
      }

      const distance = best.shanten === 0
        ? 'テンパイ'
        : best.shanten + 'シャンテン';

      panel.textContent =
        '🀄 牌効率ヒント：' +
        label(best.discard) + 'を切る\n' +
        distance + '／有効牌 ' +
        best.count + '種類（概算' +
        best.approx + '枚）\n' +
        'シャンテン数を優先し、' +
        '受け入れを残す選択です。\n' +
        '※守備・打点・公開牌は未考慮';

      panel.style.display = 'block';

    } catch (error) {
      console.warn('Coach error:', error);
      panel.style.display = 'none';
    }
  }

  function start() {
    setInterval(update, 450);
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded', start, { once: true }
    );
  } else {
    start();
  }
})();
