
'use strict';

// 電脳麻将・無料牌効率コーチ Ver.3
// UI: ヒントと打牌履歴はボタン操作時のみ表示
(function () {
  const suits = { m: '萬', p: '筒', s: '索' };
  const honors = ['', '東', '南', '西', '北', '白', '發', '中'];
  const normal = p => p[0] + (p[1] === '0' ? '5' : p[1]);
  const name = p => p[0] === 'z' ? honors[Number(p[1])]
    : (p[1] === '0' ? '赤5' : p[1]) + suits[p[0]];

  const panel = document.createElement('div');
  panel.id = 'majiang-coach-panel';
  panel.style.display = 'none';

  const historyButton = document.createElement('button');
  historyButton.id = 'majiang-coach-history-button';
  historyButton.type = 'button';
  historyButton.textContent = '📖 履歴 4.1';
  historyButton.setAttribute('aria-controls', 'majiang-coach-history-box');
  historyButton.setAttribute('aria-expanded', 'false');

  const historyBox = document.createElement('div');
  historyBox.id = 'majiang-coach-history-box';
  historyBox.style.display = 'none';

  const historyContent = document.createElement('div');
  historyContent.style.whiteSpace = 'pre-line';

  const historyClear = document.createElement('button');
  historyClear.type = 'button';
  historyClear.textContent = '履歴を削除';
  historyClear.className = 'majiang-coach-history-clear';
  historyBox.append(historyContent, historyClear);

  const hintButton = document.createElement('button');
  hintButton.id = 'majiang-coach-hint-button';
  hintButton.type = 'button';
  hintButton.textContent = '💡 ヒント';
  hintButton.setAttribute('aria-controls', 'majiang-coach-panel');
  hintButton.setAttribute('aria-expanded', 'false');

  let active = null;
  let tapped = null;
  let marks = [];
  let reviewUntil = 0;
  let lastReview = null;
  let hintOpen = false;
  let historyOpen = false;

  const historyKey = 'majiang_coach_history_v4';
  let historyItems = [];
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
    if (Array.isArray(saved)) historyItems = saved.slice(-100);
  } catch (_) {}

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

  function buildHintText() {
    if (!active || !active.ranks.length) return null;
    const best = active.ranks[0];
    const second = active.ranks[1];
    return '🀄 何切るヒント Ver.3\n' +
      '推奨：' + name(best.cut) + '／次点：' +
      (second ? name(second.cut) : 'なし') + '\n' +
      step(best.shanten) + '・有効牌' + best.types.length +
      '種類・受け入れ上限' + best.upper + '枚\n' +
      '理由：' + reason(best, second) + '\n' +
      '※牌効率のみ。公開牌・守備・打点は未評価';
  }

  function renderHint() {
    if (!hintOpen) {
      panel.style.display = 'none';
      return;
    }

    const currentText = buildHintText();
    const reviewText = lastReview ? lastReview.text : null;
    if (currentText && reviewText) {
      panel.textContent = currentText + '\n\n────────\n' +
        '📝 直前の打牌レビュー\n' + reviewText;
    } else {
      panel.textContent = currentText || reviewText ||
        '🀄 何切るヒント\n現在は表示できる推奨・レビューがありません。';
    }
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

    const reviewText =
      '📝 打牌後の振り返り Ver.3\n' +
      'あなた：' + name(cut) + '／推奨：' + name(best.cut) + '\n' +
      'あなた：' + step(mine.shanten) + '・上限' + mine.upper + '枚\n' +
      '推奨：' + step(best.shanten) + '・上限' + best.upper + '枚\n' +
      '解説：' + comment + '\n' +
      '※牌効率の比較であり、打点・守備の採点ではありません。';

    lastReview = { text: reviewText, createdAt: Date.now() };
    reviewUntil = Date.now() + 16000;
    recordHistory(mine, best);
    // 打牌によって閉じていたヒントを勝手に開かない。
    // 既に自分で開いていた場合だけ、レビュー内容を更新する。
  }

  function renderHistory() {
    const total = historyItems.length;
    const matched = historyItems.filter(r => r.own === r.best).length;
    const similar = historyItems.filter(r => r.own !== r.best &&
      r.stepDiff === 0 && r.upperDiff === 0).length;

    const lines = historyItems.slice(-15).reverse().map((r, i) => {
      const result = r.own === r.best ? '◎ 推奨一致' :
        r.stepDiff === 0 && r.upperDiff === 0 ? '○ ほぼ同等' : '△ 要復習';
      return (i + 1) + '. ' + r.own + '切り → ' + result +
        '（推奨：' + r.best + '）';
    });

    historyContent.textContent =
      '📖 打牌履歴 Ver.4\n' +
      total + '件記録 / 推奨一致 ' + matched +
      '件（' + (total ? Math.round(matched / total * 100) : 0) + '%）\n' +
      '別候補でほぼ同等：' + similar + '件\n\n' +
      (lines.length ? lines.join('\n') : 'まだ記録がありません。') +
      '\n\n※直近15件を表示・最大100件を端末内に保存';
  }

  function recordHistory(mine, best) {
    historyItems.push({
      own: name(mine.cut),
      best: name(best.cut),
      stepDiff: mine.shanten - best.shanten,
      upperDiff: best.upper - mine.upper
    });
    historyItems = historyItems.slice(-100);
    try {
      localStorage.setItem(historyKey, JSON.stringify(historyItems));
    } catch (err) {
      console.warn('履歴保存失敗', err);
    }
    if (historyOpen) renderHistory();
  }

  function setHintOpen(open) {
    hintOpen = open;
    hintButton.setAttribute('aria-expanded', String(hintOpen));
    if (hintOpen) setHistoryOpen(false);
    renderHint();
  }

  function setHistoryOpen(open) {
    historyOpen = open;
    historyButton.setAttribute('aria-expanded', String(historyOpen));
    if (historyOpen) {
      hintOpen = false;
      hintButton.setAttribute('aria-expanded', 'false');
      panel.style.display = 'none';
      renderHistory();
    }
    historyBox.style.display = historyOpen ? 'block' : 'none';
  }

  hintButton.addEventListener('click', () => setHintOpen(!hintOpen));
  historyButton.addEventListener('click', () => setHistoryOpen(!historyOpen));
  historyClear.addEventListener('click', () => {
    if (!window.confirm('打牌履歴をすべて削除しますか？')) return;
    historyItems = [];
    try { localStorage.removeItem(historyKey); } catch (_) {}
    renderHistory();
  });

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
      if (hintOpen) renderHint();
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
        if (hintOpen) renderHint();
      }
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
      if (hintOpen) renderHint();
    } catch (err) {
      console.warn('Coach v3:', err);
      active = null;
      if (hintOpen) renderHint();
    }
  }

  function installStyle() {
    if (document.getElementById('majiang-coach-style')) return;
    const style = document.createElement('style');
    style.id = 'majiang-coach-style';
    style.textContent = `
#majiang-coach-panel {
  position: fixed;
  top: calc(12px + env(safe-area-inset-top, 0px));
  right: calc(8px + env(safe-area-inset-right, 0px));
  z-index: 99999;
  box-sizing: border-box;
  max-width: 82vw;
  max-height: 60vh;
  max-height: 60dvh;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 12px;
  background: #102b27;
  color: white;
  font: 13px/1.5 sans-serif;
  white-space: pre-line;
  box-shadow: 0 3px 14px #0008;
  pointer-events: auto;
}
#majiang-coach-history-box {
  position: fixed;
  left: calc(12px + env(safe-area-inset-left, 0px));
  bottom: calc(90px + env(safe-area-inset-bottom, 0px));
  z-index: 100001;
  box-sizing: border-box;
  width: min(340px, calc(100vw - 24px));
  max-height: 45vh;
  max-height: 45dvh;
  overflow: auto;
  padding: 12px;
  border-radius: 12px;
  background: #102b27;
  color: white;
  box-shadow: 0 3px 14px #0008;
  font: 13px/1.7 sans-serif;
}
#majiang-coach-history-button,
#majiang-coach-hint-button {
  position: fixed;
  z-index: 100002;
  box-sizing: border-box;
  width: auto;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid #8ac5b2;
  border-radius: 18px;
  background: #123b32;
  color: #fff;
  font: 12px/1.3 sans-serif;
  white-space: nowrap;
  cursor: pointer;
}
#majiang-coach-history-button {
  left: calc(12px + env(safe-area-inset-left, 0px));
  top: calc(160px + env(safe-area-inset-top, 0px));
}
#majiang-coach-hint-button {
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
.majiang-coach-history-clear {
  margin-top: 12px;
  padding: 6px;
  border: 1px solid white;
  border-radius: 6px;
  background: transparent;
  color: white;
}
@media (orientation: landscape) {
  #majiang-coach-panel {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    max-width: 36vw;
    max-height: 72vh;
    max-height: 72dvh;
    font-size: 12px;
  }
  #majiang-coach-history-box {
    left: calc(12px + env(safe-area-inset-left, 0px));
    bottom: calc(48px + env(safe-area-inset-bottom, 0px));
    width: min(340px, 36vw);
    max-height: 65vh;
    max-height: 65dvh;
  }
  #majiang-coach-history-button {
    top: auto;
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  }
  #majiang-coach-hint-button {
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  }
}
`;
    document.head.appendChild(style);
  }

  function start() {
    installStyle();
    if (!historyButton.isConnected) document.body.appendChild(historyButton);
    if (!historyBox.isConnected) document.body.appendChild(historyBox);
    if (!hintButton.isConnected) document.body.appendChild(hintButton);
    if (!panel.isConnected) document.body.appendChild(panel);

    update();
    setInterval(update, 150);
    const observer = new MutationObserver(() => {
      if (tapped) checkCommitted();
    });
    const hand = document.querySelector('.shoupai.main');
    if (hand) observer.observe(hand, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
