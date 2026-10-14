
'use strict';

// 電脳麻将・無料牌効率コーチ Ver.3
(function () {
  const suits = { m: '萬', p: '筒', s: '索' };
  const honors = ['', '東', '南', '西', '北', '白', '發', '中'];
  const normal = p => p[0] + (p[1] === '0' ? '5' : p[1]);
  const name = p => p[0] === 'z' ? honors[Number(p[1])]
    : (p[1] === '0' ? '赤5' : p[1]) + suits[p[0]];

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:12px;right:8px;z-index:99999;' +
    'max-width:82vw;padding:10px 12px;border-radius:12px;' +
    'background:#102b27;color:white;font:13px/1.5 sans-serif;' +
    'box-shadow:0 3px 14px #0008;white-space:pre-line;' +
    'pointer-events:none;display:none';

  let active = null;
  let tapped = null;
  let marks = [];
  let reviewUntil = 0;

  function unmark() {
    for (const m of marks) {
      m.el.style.outline = m.outline;
      m.el.style.outlineOffset = m.offset;
    }
    marks = [];
  }

  function getHand() {
    return [...document.querySelectorAll('.shoupai.main .bingpai')]
      .find(el => el.querySelector('.pai[data-pai]')) || null;
  }

  function getTiles(hand) {
    return hand ? [...hand.querySelectorAll('.pai[data-pai]')]
      .map(el => el.dataset.pai) : [];
  }

  function analyze(tiles, cut) {
    const rest = tiles.slice();
    const index = rest.indexOf(cut);
    if (index < 0) return null;
    rest.splice(index, 1);

    const str = ['m', 'p', 's', 'z'].map(s => s + rest
      .filter(p => p[0] === s).map(p => p[1]).join('')).join('');

    const hand = Majiang.Shoupai.fromString(str);
    const shanten = Majiang.Util.xiangting(hand);
    const types = [...new Set((Majiang.Util.tingpai(hand) || [])
      .map(normal))];

    const upper = types.reduce((n, p) => n + Math.max(0, 4 -
      tiles.filter(t => normal(t) === p).length), 0);

    return { cut, shanten, types, upper };
  }

  function step(n) {
    return n === -1 ? '和了形' : n === 0 ? 'テンパイ'
      : n + 'シャンテン';
  }

  function reason(best, second) {
    if (!second) return '比較できる別候補がありません。';
    if (best.shanten < second.shanten) {
      return '次点よりシャンテン数が少なく、和了に近づきます。';
    }
    if (best.upper > second.upper) {
      return '次点より受け入れ上限が' +
        (best.upper - second.upper) + '枚多くなります。';
    }
    if (best.types.length > second.types.length) {
      return '次点より有効牌の種類が多くなります。';
    }
    return '上位候補の牌効率には大きな差がありません。';
  }

  function showHint() {
    if (!active) return;
    const best = active.ranks[0];
    const second = active.ranks[1];

    panel.textContent =
      '🀄 何切るヒント Ver.3\n' +
      '推奨：' + name(best.cut) + '／次点：' +
      (second ? name(second.cut) : 'なし') + '\n' +
      step(best.shanten) + '・有効牌' + best.types.length +
      '種類・受け入れ上限' + best.upper + '枚\n' +
      '理由：' + reason(best, second) + '\n' +
      '※牌効率のみ。公開牌・守備・打点は未評価';

    panel.style.display = 'block';
  }

  function showReview(cut) {
    if (!active) return;
    const ranks = active.ranks;
    const best = ranks[0];
    const mine = ranks.find(r => r.cut === cut);
    if (!mine) return;

    let comment;
    if (mine.cut === best.cut) {
      comment = '第一候補と一致！ 牌効率では良い選択です。';
    } else if (mine.shanten > best.shanten) {
      comment = '第一候補よりシャンテン数が' +
        (mine.shanten - best.shanten) +
        '大きくなり、和了まで遠回りになりやすい選択です。';
    } else if (mine.upper < best.upper) {
      comment = '第一候補と同じシャンテン数ですが、' +
        '受け入れ上限が' + (best.upper - mine.upper) +
        '枚少ない選択です。';
    } else if (mine.types.length < best.types.length) {
      comment = '受け入れ上限は同じですが、' +
        '有効牌の種類が少ない選択です。';
    } else {
      comment = '第一候補とは違いますが、' +
        '牌効率の数値ではほぼ同等の選択です。';
    }

    panel.textContent =
      '📝 打牌後の振り返り Ver.3\n' +
      'あなた：' + name(cut) + '／推奨：' + name(best.cut) + '\n' +
      'あなた：' + step(mine.shanten) + '・上限' + mine.upper + '枚\n' +
      '推奨：' + step(best.shanten) + '・上限' + best.upper + '枚\n' +
      '解説：' + comment + '\n' +
      '※牌効率の比較であり、打点・守備の採点ではありません。';

    panel.style.display = 'block';
    reviewUntil = Date.now() + 16000;
  }

  // 14枚から13枚になったとき、実際に切った牌を調べる。
  function detectDiscard(before, after) {
    if (after.length !== 13) return null;
    const remaining = after.slice();
    const missing = [];

    for (const p of before) {
      const i = remaining.indexOf(p);
      if (i < 0) missing.push(p);
      else remaining.splice(i, 1);
    }

    return missing.length === 1 && remaining.length === 0
      ? missing[0] : null;
  }

  
function checkCommitted() {
  if (!active || !tapped || tapped.key !== active.key) return;

  const el = tapped.element;
  const confirmed = el && (
    el.classList.contains('dapai') ||
    !!el.querySelector('.dapai') ||
    !el.hasAttribute('role') ||
    !el.isConnected
  );

  const now = getTiles(getHand());
  const detected = detectDiscard(active.tiles, now);

  if (confirmed || detected === tapped.tile) {
    showReview(tapped.tile);
    unmark();
    active = null;
    tapped = null;
  }
}

  // iPhoneの1回目のタップは選択のみ。打牌確定後に評価。
  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    const tile = target && target.closest(
      '.shoupai.main .bingpai .pai[data-pai][role="button"]'
    );

    if (!tile || !active) return;
tapped = {
  tile: tile.dataset.pai,
  key: active.key,
  element: tile
};

    setTimeout(checkCommitted, 30);
    setTimeout(checkCommitted, 150);
  }, true);

  function update() {
    if (!document.body) return;
    if (!panel.isConnected) document.body.appendChild(panel);

    checkCommitted();
    if (Date.now() < reviewUntil) return;

    const hand = getHand();
    const tiles = getTiles(hand);
    const choices = hand ? [...hand.querySelectorAll(
      '.pai[role="button"][data-pai]'
    )].map(el => el.dataset.pai) : [];

    const valid = tiles.length === 14 && choices.length > 0 &&
      tiles.every(p => /^(?:[mps][0-9]|z[1-7])$/.test(p));

    if (!valid || !window.Majiang || !Majiang.Util) {
      if (active) {
        unmark();
        active = null;
        tapped = null;
      }
      if (Date.now() > reviewUntil) panel.style.display = 'none';
      return;
    }

    const key = tiles.join('/') + '|' + choices.join('/');
    if (active && key === active.key) return;

    unmark();
    tapped = null;

    try {
      const ranks = [...new Set(choices)]
        .map(p => analyze(tiles, p)).filter(Boolean)
        .sort((a, b) => a.shanten - b.shanten ||
          b.upper - a.upper ||
          b.types.length - a.types.length ||
          Number(a.cut[1] === '0') - Number(b.cut[1] === '0'));

      if (!ranks.length) return;

      active = { key, tiles: tiles.slice(), ranks };

      const elements = [...hand.querySelectorAll('.pai[data-pai]')];
      marks = elements.filter(el => el.dataset.pai === ranks[0].cut)
        .map(el => ({
          el,
          outline: el.style.outline,
          offset: el.style.outlineOffset
        }));

      for (const m of marks) {
        m.el.style.outline = '3px solid #ffd54a';
        m.el.style.outlineOffset = '-2px';
      }

      reviewUntil = 0;
      showHint();

    } catch (err) {
      console.warn('Coach v3:', err);
      active = null;
      panel.style.display = 'none';
    }
  }

  const start = () => {
    setInterval(update, 150);

    const observer = new MutationObserver(() => {
      if (tapped) checkCommitted();
    });

    const hand = document.querySelector('.shoupai.main');
    if (hand) {
      observer.observe(hand, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
