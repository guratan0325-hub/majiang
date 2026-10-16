
'use strict';

// 電脳麻将・牌効率コーチ（公開牌補正 + 2手読み）
// 2手読み = 今の打牌 → 次のツモ → 次の打牌を評価。
(function () {
  const suits = { m: '萬', p: '筒', s: '索' };
  const honors = ['', '東', '南', '西', '北', '白', '發', '中'];
  const normal = p => p[0] + (p[1] === '0' ? '5' : p[1]);
  const name = p => p[0] === 'z' ? honors[Number(p[1])]
    : (p[1] === '0' ? '赤5' : p[1]) + suits[p[0]];

  const allTypes = [];
  for (const suit of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) allTypes.push(suit + n);
  }
  for (let n = 1; n <= 7; n++) allTypes.push('z' + n);

  const panel = document.createElement('div');
  panel.id = 'majiang-coach-panel';
  panel.style.display = 'none';

  const historyButton = document.createElement('button');
  historyButton.id = 'majiang-coach-history-button';
  historyButton.type = 'button';
  historyButton.textContent = '📖 履歴 4.1';
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
  hintButton.setAttribute('aria-expanded', 'false');

  let active = null;
  let tapped = null;
  let marks = [];
  let reviewUntil = 0;
  let lastReview = null;
  let hintOpen = false;
  let historyOpen = false;
  let lookaheadSerial = 0;

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

  function readPublicTiles() {
    const root = document.querySelector('#board .board') ||
      document.querySelector('#board');
    const result = { tiles: [], river: 0, meld: 0, dora: 0 };
    if (!root) return result;
    const groups = [
      ['river', '.he .pai[data-pai]'],
      ['meld', '.shoupai .fulou .pai[data-pai]'],
      ['dora', '.shan .baopai .pai[data-pai]']
    ];
    const seen = new Set();
    for (const [group, selector] of groups) {
      for (const el of root.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!el.getClientRects().length) continue;
        const p = el.dataset.pai;
        if (!/^(?:[mps][0-9]|z[1-7])$/.test(p || '')) continue;
        result.tiles.push(normal(p));
        result[group]++;
      }
    }
    return result;
  }

  function makeKnownCounts(tiles, publicInfo) {
    const handCounts = Object.create(null);
    const counts = Object.create(null);
    for (const p of tiles) {
      const key = normal(p);
      handCounts[key] = (handCounts[key] || 0) + 1;
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const p of publicInfo.tiles) counts[p] = (counts[p] || 0) + 1;
    const invalid = Object.values(counts).some(n => n > 4);
    return {
      counts: invalid ? handCounts : counts,
      publicCount: invalid ? 0 : publicInfo.tiles.length,
      invalid
    };
  }

  // 14枚の手牌から1枚切ったときの13枚形を評価する。
  function analyze(tiles, cut, knownCounts) {
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
    const upper = types.reduce((sum, p) => sum +
      Math.max(0, 4 - (knownCounts[p] || 0)), 0);
    return { cut, shanten, types, upper };
  }

  function compareRank(a, b) {
    return a.shanten - b.shanten || b.upper - a.upper ||
      b.types.length - a.types.length ||
      Number(a.cut[1] === '0') - Number(b.cut[1] === '0');
  }

  // 先読み計算：次に引き得る牌と、その直後の打牌を評価。
  function startLookahead(position, knownCounts) {
    const serial = ++lookaheadSerial;
    const shortlist = position.ranks
      .filter(r => r.shanten === position.ranks[0].shanten)
      .slice(0, 4);
    const jobs = [];
    const stats = new Map();
    const totalUnknown = allTypes.reduce((sum, p) =>
      sum + Math.max(0, 4 - (knownCounts[p] || 0)), 0);

    if (!totalUnknown || !shortlist.length) {
      position.lookaheadStatus = '先読み対象の牌がありません';
      return;
    }

    for (const rank of shortlist) {
      stats.set(rank.cut, {
        rank,
        weightedShanten: 0,
        weightedUpper: 0,
        weight: 0
      });
      for (const draw of allTypes) {
        const count = Math.max(0, 4 - (knownCounts[draw] || 0));
        if (count > 0) jobs.push({ rank, draw, count });
      }
    }

    let next = 0;
    const runChunk = () => {
      if (serial !== lookaheadSerial || active !== position) return;
      const started = performance.now();
      let processed = 0;

      try {
        // 各チャンクで最大2ツモ分、最大約8msを目安に処理。
        while (
          next < jobs.length &&
          processed < 2 &&
          (performance.now() - started) < 8
        ) {
          const { rank, draw, count } = jobs[next++];
          const rest = position.tiles.slice();
          rest.splice(rest.indexOf(rank.cut), 1);
          rest.push(draw);

          const futureCounts = Object.assign({}, knownCounts);
          futureCounts[draw] = (futureCounts[draw] || 0) + 1;

          const nextRanks = [...new Set(rest)]
            .map(cut => analyze(rest, cut, futureCounts))
            .filter(Boolean)
            .sort(compareRank);

          if (nextRanks.length) {
            const best = nextRanks[0];
            const item = stats.get(rank.cut);
            item.weightedShanten += best.shanten * count;
            item.weightedUpper += best.upper * count;
            item.weight += count;
          }
          processed++;
        }
      } catch (err) {
        console.warn('2手読み計算:', err);
        position.lookaheadStatus =
          '先読み失敗（従来の牌効率を使用）';
        if (hintOpen) renderHint();
        return;
      }

      if (next < jobs.length) {
        setTimeout(runChunk, 0);
        return;
      }

      const evaluated = [...stats.values()]
        .filter(item => item.weight > 0)
        .map(item => ({
          ...item,
          avgShanten: item.weightedShanten / item.weight,
          avgUpper: item.weightedUpper / item.weight
        }))
        .sort((a, b) =>
          a.avgShanten - b.avgShanten ||
          b.avgUpper - a.avgUpper ||
          compareRank(a.rank, b.rank)
        );

      if (serial !== lookaheadSerial || active !== position) return;

      position.lookahead = evaluated;
      position.lookaheadStatus = evaluated.length
        ? '先読み完了（上位' + evaluated.length + '候補）'
        : '先読み候補なし';

      updateMarks(position);
      if (hintOpen) renderHint();
    };

    setTimeout(runChunk, 0);
  }

  function bestRank(position) {
    return position.lookahead && position.lookahead.length
      ? position.lookahead[0].rank
      : position.ranks[0];
  }

  function secondRank(position) {
    return position.lookahead && position.lookahead.length > 1
      ? position.lookahead[1].rank
      : position.ranks.find(
        r => r.cut !== bestRank(position).cut
      );
  }

  function updateMarks(position) {
    if (active !== position) return;
    unmark();

    const hand = getHand();
    if (!hand) return;
    const best = bestRank(position);
    if (!best) return;

    marks = [...hand.querySelectorAll('.pai[data-pai]')]
      .filter(el => el.dataset.pai === best.cut)
      .map(el => ({
        el,
        outline: el.style.outline,
        offset: el.style.outlineOffset
      }));

    for (const m of marks) {
      m.el.style.outline = '3px solid #ffd54a';
      m.el.style.outlineOffset = '-2px';
    }
  }

  function step(n) {
    return n === -1 ? '和了形'
      : n === 0 ? 'テンパイ'
      : n + 'シャンテン';
  }

  function reason(best, second) {
    if (!second) return '比較できる別候補がありません。';
    if (best.shanten < second.shanten) {
      return '次点よりシャンテン数が少なく、和了に近づきます。';
    }
    if (best.upper > second.upper) {
      return '受け入れ上限が次点より' +
        (best.upper - second.upper) + '枚多くなります。';
    }
    if (best.types.length > second.types.length) {
      return '次点より有効牌の種類が多くなります。';
    }
    return '直近の牌効率は近いため、次のツモ後の形も比較します。';
  }

  function buildHintText() {
    if (!active || !active.ranks.length) return null;

    const best = bestRank(active);
    const second = secondRank(active);
    const note = active.lookahead && active.lookahead.length
      ? '2手読み：次のツモ後の最善打牌まで比較済み\n' +
        '平均次巡シャンテン：' +
        active.lookahead[0].avgShanten.toFixed(2) +
        '／次巡の平均受け入れ上限：' +
        active.lookahead[0].avgUpper.toFixed(1) + '枚\n' +
        '※同シャンテンの上位候補で比較・推定値'
      : '2手読み：' + active.lookaheadStatus;

    return '🀄 何切るヒント（2手読み）\n' +
      '推奨：' + name(best.cut) +
      '／次点：' +
      (second ? name(second.cut) : 'なし') + '\n' +
      step(best.shanten) +
      '・有効牌' + best.types.length +
      '種類・受け入れ上限' + best.upper + '枚\n' +
      '理由：' + reason(best, second) + '\n' +
      note + '\n' +
      '公開牌補正：' + active.publicStatus + '\n' +
      '※牌効率のみ。打点・守備・相手の隠し牌は未評価';
  }

  function renderHint() {
    if (!hintOpen) {
      panel.style.display = 'none';
      return;
    }

    const currentText = buildHintText();
    const reviewText = lastReview ? lastReview.text : null;

    panel.textContent = currentText && reviewText
      ? currentText +
        '\n\n────────\n📝 直前の打牌レビュー\n' +
        reviewText
      : (
        currentText ||
        reviewText ||
        '現在は表示できる推奨・レビューがありません。'
      );

    panel.style.display = 'block';
  }

  function showReview(cut) {
    if (!active) return;

    const best = bestRank(active);
    const mine = active.ranks.find(r => r.cut === cut);
    if (!mine || !best) return;

    let comment;

    if (mine.cut === best.cut) {
      comment = '第一候補と一致！ 牌効率では良い選択です。';
    } else if (mine.shanten > best.shanten) {
      comment = '第一候補よりシャンテン数が' +
        (mine.shanten - best.shanten) + '大きくなります。';
    } else if (mine.upper < best.upper) {
      comment = '第一候補より受け入れ上限が' +
        (best.upper - mine.upper) + '枚少ない選択です。';
    } else {
      comment =
        '現在の牌効率は近い候補です。将来の形も参考にしてください。';
    }

    lastReview = {
      text: '📝 打牌後の振り返り\n' +
        'あなた：' + name(cut) +
        '／推奨：' + name(best.cut) + '\n' +
        'あなた：' + step(mine.shanten) +
        '・上限' + mine.upper + '枚\n' +
        '推奨：' + step(best.shanten) +
        '・上限' + best.upper + '枚\n' +
        '解説：' + comment,
      createdAt: Date.now()
    };

    reviewUntil = Date.now() + 16000;
    recordHistory(mine, best);
  }

  function renderHistory() {
    const total = historyItems.length;
    const matched = historyItems.filter(
      r => r.own === r.best
    ).length;

    const similar = historyItems.filter(
      r => r.own !== r.best &&
        r.stepDiff === 0 &&
        r.upperDiff === 0
    ).length;

    const lines = historyItems.slice(-15)
      .reverse()
      .map((r, i) => {
        const result = r.own === r.best
          ? '◎ 推奨一致'
          : r.stepDiff === 0 && r.upperDiff === 0
            ? '○ ほぼ同等'
            : '△ 要復習';

        return (i + 1) + '. ' +
          r.own + '切り → ' + result +
          '（推奨：' + r.best + '）';
      });

    historyContent.textContent =
      '📖 打牌履歴 Ver.4\n' +
      total + '件記録 / 推奨一致 ' +
      matched + '件（' +
      (total ? Math.round(matched / total * 100) : 0) +
      '%）\n' +
      '別候補でほぼ同等：' +
      similar + '件\n\n' +
      (
        lines.length
          ? lines.join('\n')
          : 'まだ記録がありません。'
      ) +
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
      localStorage.setItem(
        historyKey,
        JSON.stringify(historyItems)
      );
    } catch (err) {
      console.warn('履歴保存失敗', err);
    }

    if (historyOpen) renderHistory();
  }

  function setHintOpen(open) {
    hintOpen = open;
    hintButton.setAttribute(
      'aria-expanded',
      String(hintOpen)
    );

    if (hintOpen) setHistoryOpen(false);
    renderHint();
  }

  function setHistoryOpen(open) {
    historyOpen = open;
    historyButton.setAttribute(
      'aria-expanded',
      String(historyOpen)
    );

    if (historyOpen) {
      hintOpen = false;
      hintButton.setAttribute('aria-expanded', 'false');
      panel.style.display = 'none';
      renderHistory();
    }

    historyBox.style.display =
      historyOpen ? 'block' : 'none';
  }

  hintButton.addEventListener('click', () => {
    setHintOpen(!hintOpen);
  });

  historyButton.addEventListener('click', () => {
    setHistoryOpen(!historyOpen);
  });

  historyClear.addEventListener('click', () => {
    if (!window.confirm(
      '打牌履歴をすべて削除しますか？'
    )) return;

    historyItems = [];

    try {
      localStorage.removeItem(historyKey);
    } catch (_) {}

    renderHistory();
  });

  function detectDiscard(before, after) {
    if (after.length !== 13) return null;

    const remaining = after.slice();
    const missing = [];

    for (const p of before) {
      const i = remaining.indexOf(p);

      if (i < 0) {
        missing.push(p);
      } else {
        remaining.splice(i, 1);
      }
    }

    return missing.length === 1 &&
      remaining.length === 0
      ? missing[0]
      : null;
  }

  function checkCommitted() {
    if (!active || !tapped ||
        tapped.key !== active.key) return;

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
      ++lookaheadSerial;
      tapped = null;

      if (hintOpen) renderHint();
    }
  }

  document.addEventListener('click', e => {
    const target = e.target instanceof Element
      ? e.target
      : null;

    const tile = target && target.closest(
      '.shoupai.main .bingpai ' +
      '.pai[data-pai][role="button"]'
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

    const choices = hand
      ? [...hand.querySelectorAll(
        '.pai[role="button"][data-pai]'
      )].map(el => el.dataset.pai)
      : [];

    const valid =
      tiles.length === 14 &&
      choices.length > 0 &&
      tiles.every(
        p => /^(?:[mps][0-9]|z[1-7])$/.test(p)
      );

    if (!valid || !window.Majiang ||
        !Majiang.Util) {
      if (active) {
        unmark();
        active = null;
        ++lookaheadSerial;
        tapped = null;
        if (hintOpen) renderHint();
      }
      return;
    }

    const publicInfo = readPublicTiles();

    const key =
      tiles.join('/') + '|' +
      choices.join('/') + '|public:' +
      publicInfo.tiles.slice().sort().join('/');

    if (active && key === active.key) return;

    unmark();
    ++lookaheadSerial;
    tapped = null;

    try {
      const known = makeKnownCounts(
        tiles,
        publicInfo
      );

      const ranks = [...new Set(choices)]
        .map(p => analyze(
          tiles,
          p,
          known.counts
        ))
        .filter(Boolean)
        .sort(compareRank);

      if (!ranks.length) return;

      const publicStatus = known.invalid
        ? '公開牌の重複を検知、手牌のみ'
        : known.publicCount > 0
          ? '読み取れた公開牌' +
            known.publicCount + '枚を補正'
          : '手牌のみ（公開牌の取得未確認）';

      const position = {
        key,
        tiles: tiles.slice(),
        ranks,
        publicStatus,
        lookahead: null,
        lookaheadStatus: '計算中…'
      };

      active = position;
      updateMarks(position);

      if (hintOpen) renderHint();

      const hasOwnMeld = !!document.querySelector(
        '.shoupai.main .fulou .pai, ' +
        '.shoupai.main .fulou .mianzi'
      );

      if (hasOwnMeld) {
        position.lookaheadStatus =
          '自分の鳴き手は未対応（従来の評価）';
        if (hintOpen) renderHint();
      } else {
        startLookahead(position, known.counts);
      }
    } catch (err) {
      console.warn('Coach:', err);
      active = null;
      if (hintOpen) renderHint();
    }
  }

  function installStyle() {
    if (document.getElementById(
      'majiang-coach-style'
    )) return;

    const style = document.createElement('style');
    style.id = 'majiang-coach-style';

    style.textContent = `
#majiang-coach-panel {
  position:fixed;
  top:calc(12px + env(safe-area-inset-top,0px));
  right:calc(8px + env(safe-area-inset-right,0px));
  z-index:99999;
  box-sizing:border-box;
  max-width:82vw;
  max-height:60dvh;
  overflow:auto;
  padding:10px 12px;
  border-radius:12px;
  background:#102b27;
  color:white;
  font:13px/1.5 sans-serif;
  white-space:pre-line;
  box-shadow:0 3px 14px #0008;
  pointer-events:auto;
}

#majiang-coach-history-box {
  position:fixed;
  left:calc(12px + env(safe-area-inset-left,0px));
  bottom:calc(90px + env(safe-area-inset-bottom,0px));
  z-index:100001;
  box-sizing:border-box;
  width:min(340px,calc(100vw - 24px));
  max-height:45dvh;
  overflow:auto;
  padding:12px;
  border-radius:12px;
  background:#102b27;
  color:white;
  box-shadow:0 3px 14px #0008;
  font:13px/1.7 sans-serif;
}

#majiang-coach-history-button,
#majiang-coach-hint-button {
  position:fixed;
  z-index:100002;
  box-sizing:border-box;
  width:auto;
  min-width:0;
  padding:8px 9px;
  border:1px solid #8ac5b2;
  border-radius:18px;
  background:#123b32;
  color:#fff;
  font:12px/1.3 sans-serif;
  white-space:nowrap;
  cursor:pointer;
}

#majiang-coach-history-button {
  left:calc(12px + env(safe-area-inset-left,0px));
  top:calc(160px + env(safe-area-inset-top,0px));
}

#majiang-coach-hint-button {
  right:calc(12px + env(safe-area-inset-right,0px));
  bottom:calc(12px + env(safe-area-inset-bottom,0px));
}

.majiang-coach-history-clear {
  margin-top:12px;
  padding:6px;
  border:1px solid white;
  border-radius:6px;
  background:transparent;
  color:white;
}

@media (orientation:landscape) {
  #majiang-coach-panel {
    top:calc(10px + env(safe-area-inset-top,0px));
    right:calc(12px + env(safe-area-inset-right,0px));
    max-width:36vw;
    max-height:72dvh;
    font-size:12px;
  }

  #majiang-coach-history-box {
    left:calc(12px + env(safe-area-inset-left,0px));
    bottom:calc(48px + env(safe-area-inset-bottom,0px));
    width:min(340px,36vw);
    max-height:65dvh;
  }

  #majiang-coach-history-button {
    top:auto;
    bottom:calc(8px + env(safe-area-inset-bottom,0px));
  }

  #majiang-coach-hint-button {
    bottom:calc(8px + env(safe-area-inset-bottom,0px));
  }
}
`;

    document.head.appendChild(style);
  }

  function start() {
    installStyle();

    for (const el of [
      historyButton,
      historyBox,
      hintButton,
      panel
    ]) {
      if (!el.isConnected) {
        document.body.appendChild(el);
      }
    }

    update();
    setInterval(update, 150);

    const observer = new MutationObserver(() => {
      if (tapped) checkCommitted();
    });

    const hand = document.querySelector('.shoupai.main');

    if (hand) {
      observer.observe(hand, {
        childList: true,
        subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
  
  // --- 役・ドラ補助評価 Ver.4（試験版） ---
  const originalBestRank = bestRank;
  const originalSecondRank = secondRank;
  const originalBuildHintText = buildHintText;
  const originalShowReview = showReview;

  // ドラ表示牌から実際のドラを求める
  function indicatorToDora(indicator) {
    const p = normal(indicator);
    const suit = p[0];
    const number = Number(p[1]);

    if (suit === 'z') {
      if (number >= 1 && number <= 4) {
        return 'z' + (number === 4 ? 1 : number + 1);
      }
      if (number >= 5 && number <= 7) {
        return 'z' + (number === 7 ? 5 : number + 1);
      }
      return null;
    }

    if ('mps'.includes(suit) &&
        number >= 1 && number <= 9) {
      return suit + (number === 9 ? 1 : number + 1);
    }
    return null;
  }

  function visibleDoraTypes() {
    const root =
      document.querySelector('#board .board') ||
      document.querySelector('#board') ||
      document;

    return [...root.querySelectorAll(
      '.shan .baopai .pai[data-pai]'
    )]
      .filter(el => el.getClientRects().length > 0)
      .map(el => indicatorToDora(el.dataset.pai || ''))
      .filter(Boolean);
  }

  // 候補を切った後のドラ・役の狙いやすさ
  function scoreYakuDora(position, cut, doraTypes) {
    const rest = position.tiles.slice();
    const index = rest.indexOf(cut);
    if (index < 0) {
      return { score: 0, notes: [] };
    }

    rest.splice(index, 1);

    const counts = Object.create(null);
    const suitCounts = { m: 0, p: 0, s: 0 };
    let terminalHonors = 0;
    let honorCount = 0;
    let akaCount = 0;

    for (const raw of rest) {
      const p = normal(raw);
      counts[p] = (counts[p] || 0) + 1;

      if (raw[1] === '0') akaCount++;

      if (p[0] === 'z') {
        terminalHonors++;
        honorCount++;
      } else {
        suitCounts[p[0]]++;
        if (p[1] === '1' || p[1] === '9') {
          terminalHonors++;
        }
      }
    }

    const doraCount = doraTypes.reduce(
      (sum, p) => sum + (counts[p] || 0),
      0
    );

    let score = doraCount + akaCount;
    const notes = [];

    if (doraTypes.length) {
      notes.push(
        'ドラ' + doraCount + '枚（表示牌から判定）'
      );
    } else {
      notes.push('ドラ表示牌は未確認');
    }

    if (akaCount) {
      notes.push('赤ドラ' + akaCount + '枚');
    }

    // タンヤオを狙いやすい形
    if (terminalHonors <= 3) {
      score += (4 - terminalHonors) * 0.25;
      notes.push('タンヤオ形に近い');
    }

    // 三元牌の対子・刻子
    // 自風・場風はまだ判定しない
    const dragonPairs = ['z5', 'z6', 'z7']
      .filter(p => (counts[p] || 0) >= 2)
      .length;

    if (dragonPairs) {
      score += dragonPairs * 0.45;
      notes.push('三元牌の対子・刻子あり');
    }

    // ホンイツ・チンイツの傾向
    const maxSuit = Math.max(
      suitCounts.m,
      suitCounts.p,
      suitCounts.s
    );

    const otherSuits =
      13 - honorCount - maxSuit;

    if (maxSuit >= 9 && otherSuits <= 2) {
      score += (maxSuit - 8) * 0.18;
      notes.push(
        honorCount
          ? 'ホンイツ候補'
          : 'チンイツ候補'
      );
    }

    return { score, notes };
  }

  function yakuAdjustedCandidates(position) {
    if (!position ||
        !position.ranks ||
        !position.ranks.length) {
      return [];
    }

    const ahead =
      position.lookahead && position.lookahead.length
        ? position.lookahead.map(item => ({
            rank: item.rank,
            shanten: item.avgShanten,
            upper: item.avgUpper
          }))
        : position.ranks
            .filter(r =>
              r.shanten === position.ranks[0].shanten
            )
            .slice(0, 4)
            .map(r => ({
              rank: r,
              shanten: r.shanten,
              upper: r.upper
            }));

    if (!ahead.length) return [];

    const doraTypes = visibleDoraTypes();

    const enriched = ahead.map((item, i) => ({
      ...item,
      i,
      bonus: scoreYakuDora(
        position,
        item.rank.cut,
        doraTypes
      )
    }));

    const reference = enriched[0];

    // 2手読みの評価が近い候補だけ
    // 役・ドラで順位を入れ替える
    const near = enriched.filter(item =>
      item.shanten <= reference.shanten + 0.03 &&
      item.upper >= reference.upper - 4
    );

    const other = enriched.filter(
      item => !near.includes(item)
    );

    near.sort(
      (a, b) =>
        b.bonus.score - a.bonus.score ||
        a.i - b.i
    );

    return [...near, ...other];
  }

  // 従来の推奨に役・ドラ評価を補助的に追加
  bestRank = function (position) {
    if (!position ||
        !position.ranks ||
        !position.ranks.length) {
      return originalBestRank(position);
    }

    if (position.lookaheadStatus &&
        position.lookaheadStatus.includes('鳴き手')) {
      return originalBestRank(position);
    }

    const ranks = yakuAdjustedCandidates(position);

    return ranks.length
      ? ranks[0].rank
      : originalBestRank(position);
  };

  secondRank = function (position) {
    if (!position ||
        !position.ranks ||
        !position.ranks.length ||
        (position.lookaheadStatus &&
         position.lookaheadStatus.includes('鳴き手'))) {
      return originalSecondRank(position);
    }

    const ranks = yakuAdjustedCandidates(position);

    return ranks.length > 1
      ? ranks[1].rank
      : originalSecondRank(position);
  };

  // ヒントに役・ドラの補助評価を表示
  buildHintText = function () {
    const text = originalBuildHintText();

    if (!text || !active || !active.ranks.length) {
      return text;
    }

    if (active.lookaheadStatus &&
        active.lookaheadStatus.includes('鳴き手')) {
      return text + '\n打点傾向：鳴き手は未対応';
    }

    const best = bestRank(active);

    const bonus = scoreYakuDora(
      active,
      best.cut,
      visibleDoraTypes()
    );

    return text +
      '\n【役・ドラ補助評価（試験版）】\n' +
      bonus.notes.join('／') + '\n' +
      '※近い牌効率の候補だけで加味。' +
      '点数期待値ではありません。';
  };

  showReview = function (cut) {
    const previousReview = lastReview;
    originalShowReview(cut);

    if (lastReview &&
        lastReview !== previousReview) {
      lastReview.text +=
        '\n※推奨にはドラ・役の傾向による' +
        '補助評価が含まれます。';
    }
  };

  // --- 追加ここまで ---

})();
