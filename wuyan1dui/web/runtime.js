/**
 * 无言以队 · 前端运行时
 *
 * 关键设计（满足"双击 index.html 即可运行"的架构 II 约束）：
 *   - file:// 下浏览器禁止 fetch 本地文件 → 所有数据与规则内联，不依赖外部 JSON
 *   - 后端不可达时自动降级为本地引擎（纯 JS 计算），功能完全可用
 *   - 每条路径都返回 {ok, data, meta}，前端无需区分在线/离线
 */
(function (root) {
  'use strict';

  var API_BASE = 'http://127.0.0.1:3001';
  var LS_KEY = 'wuyan_v1_';
  var memStore = {};

  /* ============ 存储（localStorage 优先，file:// 降级为内存） ============ */
  var store = {
    kind: 'memory',
    get: function (k, def) {
      try {
        var raw = (window.localStorage && window.localStorage.getItem(LS_KEY + k))
          || memStore[k];
        return raw ? JSON.parse(raw) : (def === undefined ? null : def);
      } catch (e) { return def === undefined ? null : def; }
    },
    set: function (k, v) {
      var raw = JSON.stringify(v);
      memStore[k] = raw;
      try {
        if (window.localStorage) {
          window.localStorage.setItem(LS_KEY + k, raw);
          store.kind = 'localStorage';
        }
      } catch (e) { /* file:// 或隐私模式下降级为内存 */ }
      return true;
    },
    del: function (k) {
      delete memStore[k];
      try { if (window.localStorage) window.localStorage.removeItem(LS_KEY + k); } catch (e) {}
    },
    clear: function () {
      memStore = {};
      try {
        if (window.localStorage) {
          Object.keys(window.localStorage)
            .filter(function (k) { return k.indexOf(LS_KEY) === 0; })
            .forEach(function (k) { window.localStorage.removeItem(k); });
        }
      } catch (e) {}
    }
  };

  /* ============ API 客户端 ============ */
  var apiState = {
    online: false,          /* 后端是否可达 */
    mode: 'demo',           /* 用户选择：demo | live */
    health: null,
    lastCheck: 0
  };
  var MODE_KEY = 'mode';

  function getMode() {
    var m = store.get(MODE_KEY, 'demo');
    return (m === 'live') ? 'live' : 'demo';
  }
  function setMode(m) {
    apiState.mode = (m === 'live') ? 'live' : 'demo';
    store.set(MODE_KEY, apiState.mode);
    return apiState.mode;
  }

  /** 探测后端健康状态 */
  function checkHealth(force) {
    var now = Date.now();
    if (!force && apiState.health && (now - apiState.lastCheck) < 15000) {
      return Promise.resolve(apiState.health);
    }
    return fetch(API_BASE + '/api/health', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        apiState.online = true;
        apiState.health = j;
        apiState.lastCheck = Date.now();
        return j;
      })
      .catch(function () {
        apiState.online = false;
        apiState.health = { ok: false, mode: 'demo', connected: false, message: '后端未启动，已使用本地离线引擎' };
        apiState.lastCheck = Date.now();
        return apiState.health;
      });
  }

  var ENDPOINT = {
    aggregate: '/api/aggregate',
    parseIntent: '/api/parse-intent',
    upload: '/api/upload-summary',
    risk: '/api/risk-signal',
    clue: '/api/clues',
    score: '/api/score',
    evidence: '/api/evidence-check',
    report: '/api/report',
    qa: '/api/qa',
    reminder: '/api/reminder',
    health: '/api/health',
    tables: '/api/tables',
    examples: '/api/examples'
  };

  /**
   * 调用分析接口。
   * 在线：走后端 /api/*（带 X-Wuyan-Mode 头）
   * 离线：走本地引擎（等价计算，结果可复现）
   */
  function call(name, payload) {
    var ep = ENDPOINT[name];
    if (!ep) return Promise.reject(new Error('未知接口 ' + name));
    var mode = getMode();

    return checkHealth(false).then(function (health) {
      if (!apiState.online) {
        /* 离线：本地引擎计算 */
        return localCall(name, payload, 'offline');
      }
      /* 在线模式 */
      var headerMode = (mode === 'live') ? 'live' : 'demo';
      return fetch(API_BASE + ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wuyan-Mode': headerMode },
        body: JSON.stringify(payload || {})
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            throw new Error(j.error || ('接口返回 ' + r.status));
          }).catch(function (e) {
            if (e && e.message && e.message.indexOf('接口返回') === 0) throw e;
            throw new Error('接口返回 ' + r.status);
          });
        }
        return r.json();
      }).then(function (j) {
        j.__via = 'server';
        return j;
      }).catch(function (err) {
        /* 后端异常：降级本地引擎，保证功能可用 */
        if (err && err.message && /接口返回|请求体|SQL|未知接口|不支持/.test(err.message)) throw err;
        return localCall(name, payload, 'offline-fallback');
      });
    });
  }

  /** 本地引擎计算（不依赖后端） */
  function localCall(name, payload, via) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var D = window.WyDemo.build();
          var engine = window.WyEngine;
          var p = payload || {};
          var out;
          switch (name) {
            case 'aggregate': out = engine.aggregate(D, p); break;
            case 'parseIntent': out = engine.parseIntent(D, p); break;
            case 'upload': out = engine.uploadSummary(D, p); break;
            case 'risk': out = engine.riskSignal(D, p); break;
            case 'clue': out = engine.clues(D, p); break;
            case 'score': out = engine.score(D, p); break;
            case 'evidence': out = engine.evidence(D, p); break;
            case 'report': {
              var risk = engine.riskSignal(D, p);
              var cl = engine.clues(D, p, risk);
              var sc = engine.score(D, p, risk);
              var ev = engine.evidence(D, p);
              out = engine.report(D, p, { risk: risk, clues: cl, score: sc, evidence: ev });
              out.markdown = engine.reportToMarkdown(out);
              break;
            }
            case 'qa': out = engine.qa(D, p); break;
            case 'reminder': {
              var cl2 = engine.clues(D, p);
              var ev2 = engine.evidence(D, p);
              out = engine.reminders(D, p, cl2, ev2);
              break;
            }
            case 'tables': {
              var core = window.WyCore;
              out = {
                tables: Object.keys(core.TABLE_META).map(function (t) {
                  return { name: t, label: core.TABLE_META[t].name, system: core.TABLE_META[t].sys,
                    key: core.TABLE_META[t].key, fields: core.TABLE_META[t].fields };
                }),
                groups: core.SYSTEM_GROUPS,
                count: Object.keys(core.TABLE_META).length,
                rules: core.RULES.map(function (r) {
                  return { id: r.id, name: r.name, step: r.step, category: r.category, weight: r.weight, param: r.param };
                }),
                disclaimer: core.DISCLAIMER_LONG,
                trace: engine.trace([], {}, [])
              };
              break;
            }
            case 'examples': {
              out = { examples: window.WyCore.DEMO_EXAMPLES,
                disclaimer: window.WyCore.DISCLAIMER_LONG, trace: engine.trace([], {}, []) };
              break;
            }
            default: throw new Error('本地引擎不支持：' + name);
          }
          out.__via = via;
          out.dataSource = out.dataSource || {
            mode: 'demo', label: '演示数据（本地离线引擎）',
            gaps: ['当前为离线演示模式，数据来自内联 PRELOAD_DEMO 数据集']
          };
          resolve(out);
        } catch (e) {
          reject(e);
        }
      }, 80);
    });
  }

  /* ============ 通用工具 ============ */
  var U = {
    num: function (v) { var n = Number(v); return isFinite(n) ? n : 0; },
    money: function (v, dp) {
      var n = Number(v || 0);
      if (!isFinite(n)) return '—';
      var d = (dp === undefined) ? 2 : dp;
      return n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    /** 金额自适应：万元/元 */
    moneyShort: function (v) {
      var n = Number(v || 0);
      if (!isFinite(n) || n === 0) return '0';
      var abs = Math.abs(n);
      if (abs >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
      if (abs >= 10000) return (n / 10000).toFixed(2) + ' 万';
      return n.toFixed(2);
    },
    pct: function (v, dp) {
      var n = Number(v || 0);
      if (!isFinite(n)) return '—';
      return n.toFixed(dp === undefined ? 2 : dp) + '%';
    },
    esc: function (s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    gradeClass: function (g) {
      return 'grade grade-' + (g || 'unknown');
    },
    gradeLabel: function (g) {
      var m = { high: '高度可疑', medium: '中度可疑', low: '低度可疑', unknown: '信息不足待补充' };
      return m[g] || '信息不足待补充';
    },
    gradeBadge: function (g, extra) {
      return '<span class="' + U.gradeClass(g) + '">' + U.esc(U.gradeLabel(g))
        + (extra ? ' · ' + U.esc(extra) : '') + '</span>';
    },
    date: function (v) {
      if (!v) return '—';
      return String(v).slice(0, 10);
    },
    datetime: function (v) {
      if (!v) return '—';
      var d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      var p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    todayStr: function () {
      var d = new Date();
      var p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    uid: function (pre) {
      return (pre || 'id') + '_' + Math.random().toString(36).slice(2, 9);
    },
    debounce: function (fn, ms) {
      var t = null;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
      };
    },
    /** 下载文本文件 */
    download: function (filename, content, mime) {
      try {
        var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 1500);
        return true;
      } catch (e) {
        return false;
      }
    },
    copy: function (text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return true;
        }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
  };

  /* ============ Toast ============ */
  function toast(msg, type, ms) {
    var wrap = document.getElementById('toastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toastWrap';
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, ms || 2600);
  }

  /* ============ 表格渲染（支持排序、分页、行高亮） ============ */
  /**
   * @param {Object} opt
   *   columns: [{key, label, type:'text'|'num'|'grade'|'date'|'html', width, align}]
   *   rows: 数据数组
   *   gradeField: 用于行高亮的等级字段名
   *   pageSize: 每页行数（0 表示不分页）
   *   emptyText
   */
  function renderTable(opt) {
    var cols = opt.columns || [];
    var rows = (opt.rows || []).slice();
    var pageSize = opt.pageSize === undefined ? 50 : opt.pageSize;
    var state = { sortKey: opt.sortKey || null, sortDir: opt.sortDir || 'desc', page: 1 };
    var host = document.createElement('div');
    host.className = 'table-host';

    function sortRows() {
      if (!state.sortKey) return rows;
      var k = state.sortKey;
      var dir = state.sortDir === 'asc' ? 1 : -1;
      return rows.slice().sort(function (a, b) {
        var va = a[k], vb = b[k];
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        var na = Number(va), nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') return (na - nb) * dir;
        return String(va).localeCompare(String(vb), 'zh-CN') * dir;
      });
    }

    function cellHtml(col, row) {
      var v = row[col.key];
      if (col.render) return col.render(v, row);
      if (col.type === 'grade') return U.gradeBadge(v);
      if (col.type === 'num') return v === null || v === undefined || v === '' ? '—' : U.money(v, col.dp === undefined ? 2 : col.dp);
      if (col.type === 'int') return v === null || v === undefined ? '—' : String(v);
      if (col.type === 'date') return U.date(v);
      if (col.type === 'html') return v === null || v === undefined ? '' : String(v);
      if (col.type === 'array') return Array.isArray(v) ? v.map(function (x) {
        return '<span class="tag">' + U.esc(x) + '</span>';
      }).join(' ') : U.esc(v);
      return v === null || v === undefined || v === '' ? '—' : U.esc(v);
    }

    function draw() {
      var sorted = sortRows();
      var total = sorted.length;
      var pages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
      if (state.page > pages) state.page = pages;
      var start = pageSize > 0 ? (state.page - 1) * pageSize : 0;
      var view = pageSize > 0 ? sorted.slice(start, start + pageSize) : sorted;

      var h = '<div class="table-wrap"><table class="data"><thead><tr>';
      cols.forEach(function (c) {
        var cls = (state.sortKey === c.key ? 'sorted ' : '');
        h += '<th class="' + cls + '" data-sort="' + U.esc(c.key) + '"'
          + (c.width ? ' style="min-width:' + c.width + '"' : '') + '>'
          + U.esc(c.label)
          + '<span class="sort-ind">' + (state.sortKey === c.key ? (state.sortDir === 'asc' ? '▲' : '▼') : '⇅') + '</span></th>';
      });
      h += '</tr></thead><tbody>';

      if (!view.length) {
        h += '<tr><td colspan="' + cols.length + '"><div class="table-empty">'
          + U.esc(opt.emptyText || '暂无数据') + '</div></td></tr>';
      } else {
        view.forEach(function (row) {
          var g = opt.gradeField ? row[opt.gradeField] : '';
          h += '<tr class="' + (g ? 'row-' + g : '') + '">';
          cols.forEach(function (c) {
            var align = c.align || (c.type === 'num' ? 'right' : 'left');
            var cls = align === 'right' ? 'num' : (c.mono ? 'mono' : '');
            h += '<td class="' + cls + '">' + cellHtml(c, row) + '</td>';
          });
          h += '</tr>';
        });
      }
      h += '</tbody></table></div>';

      /* 表尾：总数 + 分页 */
      h += '<div class="table-foot"><span>共 <b>' + total + '</b> 条'
        + (pageSize > 0 && total > pageSize ? '，第 ' + state.page + ' / ' + pages + ' 页' : '')
        + '</span>';
      if (pageSize > 0 && pages > 1) {
        h += '<div class="pager">';
        h += '<button data-pg="1" ' + (state.page === 1 ? 'disabled' : '') + '>«</button>';
        h += '<button data-pg="' + (state.page - 1) + '" ' + (state.page === 1 ? 'disabled' : '') + '>‹</button>';
        var from = Math.max(1, state.page - 2), to = Math.min(pages, from + 4);
        for (var i = from; i <= to; i++) {
          h += '<button data-pg="' + i + '" class="' + (i === state.page ? 'cur' : '') + '">' + i + '</button>';
        }
        h += '<button data-pg="' + (state.page + 1) + '" ' + (state.page === pages ? 'disabled' : '') + '>›</button>';
        h += '<button data-pg="' + pages + '" ' + (state.page === pages ? 'disabled' : '') + '>»</button>';
        h += '</div>';
      }
      h += '</div>';
      host.innerHTML = h;

      host.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var k = th.getAttribute('data-sort');
          if (state.sortKey === k) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortKey = k; state.sortDir = 'desc';
          }
          draw();
        });
      });
      host.querySelectorAll('.pager button[data-pg]').forEach(function (b) {
        b.addEventListener('click', function () {
          var pg = Number(b.getAttribute('data-pg'));
          if (!isNaN(pg)) { state.page = pg; draw(); }
        });
      });
    }

    draw();
    return host;
  }

  /* ============ 内联 SVG 图表 ============ */
  var Chart = {
    /**
     * 水平条形图（HTML 布局，避免 SVG 文字拉伸）
     * items: [{label, value, color}]
     */
    bar: function (items, opt) {
      opt = opt || {};
      var data = (items || []).filter(function (x) { return x.value > 0; });
      if (!data.length) return '<div class="table-empty">暂无数据</div>';
      var max = Math.max.apply(null, data.map(function (x) { return x.value; })) || 1;
      /* 极差过大时采用平方根压缩，使小值仍可辨识 */
      var useSqrt = max / (Math.min.apply(null, data.map(function (x) { return x.value; })) || 1) > 6;
      var scale = function (v) { return useSqrt ? Math.sqrt(v) : v; };
      var maxS = scale(max) || 1;
      var h = '<div class="hbar-chart">';
      data.forEach(function (d) {
        var pctW = Math.max((scale(d.value) / maxS) * 100, 1.5);
        h += '<div class="hbar-row" title="' + U.esc(d.label) + '：' + d.value + '">'
          + '<span class="hbar-label">' + U.esc(d.label) + '</span>'
          + '<span class="hbar-track"><i class="hbar-fill" style="width:' + pctW + '%;background:'
          + (d.color || '#2F80ED') + '"></i></span>'
          + '<span class="hbar-value">' + U.esc(String(d.value)) + '</span>'
          + '</div>';
      });
      h += '</div>';
      return h;
    },

    /** 环形图（用于等级分布） */
    donut: function (items, opt) {
      opt = opt || {};
      var data = (items || []).filter(function (x) { return x.value > 0; });
      var total = data.reduce(function (a, x) { return a + x.value; }, 0);
      if (!total) return '<div class="table-empty">暂无数据</div>';
      var cx = 50, cy = 50, r = 34, sw = 13;
      var circ = 2 * Math.PI * r;
      var off = 0;
      var svg = '<svg viewBox="0 0 100 100" style="max-width:170px;margin:0 auto;display:block">';
      data.forEach(function (d) {
        var frac = d.value / total;
        var len = frac * circ;
        svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + (d.color || '#2F80ED')
          + '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2)
          + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"></circle>';
        off += len;
      });
      svg += '<text x="50" y="49" text-anchor="middle" font-size="13" font-weight="700" fill="#123A6B">' + total + '</text>';
      svg += '<text x="50" y="59" text-anchor="middle" font-size="6" fill="#8A93A3">条信号</text>';
      svg += '</svg>';
      var legend = '<div class="chart-legend">' + data.map(function (d) {
        return '<span><i style="background:' + (d.color || '#2F80ED') + '"></i>'
          + U.esc(d.label) + ' ' + d.value + '</span>';
      }).join('') + '</div>';
      return svg + legend;
    },

    /**
     * 折线图（用于指标趋势）
     * 关键：preserveAspectRatio 保持默认（不拉伸），仅在纵向压缩
     */
    line: function (series, opt) {
      opt = opt || {};
      var vals = (series || []).map(function (x) { return U.num(x.v); });
      if (!vals.length) return '<div class="table-empty">暂无数据</div>';
      var w = 320, h = 120, padL = 34, padR = 8, padT = 10, padB = 22;
      var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
      var span = (mx - mn) || 1;
      var iw = w - padL - padR, ih = h - padT - padB;
      var pts = vals.map(function (v, i) {
        var x = padL + (vals.length > 1 ? (i / (vals.length - 1)) : 0.5) * iw;
        var y = padT + ih - ((v - mn) / span) * ih;
        return { x: x, y: y, v: v };
      });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      /* 面积 */
      var area = d + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (padT + ih)
        + ' L' + pts[0].x.toFixed(1) + ' ' + (padT + ih) + ' Z';
      var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;display:block">';
      svg += '<defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0%" stop-color="#2F80ED" stop-opacity=".22"/>'
        + '<stop offset="100%" stop-color="#2F80ED" stop-opacity="0"/></linearGradient></defs>';
      /* 网格线 */
      for (var g = 0; g <= 3; g++) {
        var gy = padT + (ih / 3) * g;
        svg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gy.toFixed(1)
          + '" stroke="#EDF1F7" stroke-width="1"></line>';
        var lv = mx - (span / 3) * g;
        svg += '<text x="' + (padL - 4) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="#8A93A3">'
          + lv.toFixed(0) + '</text>';
      }
      svg += '<path d="' + area + '" fill="url(#lg1)"></path>';
      svg += '<path d="' + d + '" fill="none" stroke="#2F80ED" stroke-width="1.8" stroke-linejoin="round"></path>';
      pts.forEach(function (p) {
        svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.2" fill="#fff" stroke="#1E5AA8" stroke-width="1.4"></circle>';
      });
      svg += '</svg>';
      if (opt.labels && opt.labels.length) {
        var step = Math.max(1, Math.ceil(opt.labels.length / 6));
        svg += '<div class="chart-legend">' + opt.labels.map(function (l, i) {
          return (i % step === 0) ? '<span>' + U.esc(l) + '</span>' : '';
        }).join('') + '</div>';
      }
      return svg;
    }
  };

  /* ============ 溯源轨迹面板 ============ */
  /**
   * @param {Object} t  trace 对象 {tables:[{name,label,system}], query, ruleIds, sql}
   * @param {Object} opt {open:boolean, extra:[]}
   */
  function renderTrace(t, opt) {
    opt = opt || {};
    if (!t) return '';
    var tables = t.tables || [];
    var rules = t.ruleIds || [];
    var h = '<div class="trace' + (opt.open ? ' open' : '') + '">';
    h += '<div class="trace-head"><span>🔎 溯源轨迹 · 数据来源与命中规则</span>'
      + '<span class="chev">▶</span></div>';
    h += '<div class="trace-body">';

    h += '<div class="trace-section"><div class="trace-label">数据来源表（' + tables.length + '）</div><div class="trace-chips">';
    if (!tables.length) h += '<span class="dim">无</span>';
    tables.forEach(function (tb) {
      h += '<span class="tag tag-blue" title="' + U.esc(tb.system) + '">' + U.esc(tb.name)
        + (tb.label ? ' · ' + U.esc(tb.label) : '') + '</span>';
    });
    h += '</div></div>';

    h += '<div class="trace-section"><div class="trace-label">查询条件</div><div class="trace-chips">';
    var q = t.query || {};
    var hasQ = false;
    Object.keys(q).forEach(function (k) {
      if (q[k] === undefined || q[k] === null || q[k] === '' || k === 'sql') return;
      hasQ = true;
      var v = Array.isArray(q[k]) ? q[k].filter(Boolean).join(' ~ ') : q[k];
      h += '<span class="tag">' + U.esc(k) + ' = ' + U.esc(v) + '</span>';
    });
    if (!hasQ) h += '<span class="dim">全量</span>';
    h += '</div></div>';

    h += '<div class="trace-section"><div class="trace-label">命中规则编号（' + rules.length + '）</div><div class="trace-chips">';
    if (!rules.length) h += '<span class="dim">无</span>';
    rules.forEach(function (r) { h += '<span class="tag tag-warn mono">' + U.esc(r) + '</span>'; });
    h += '</div></div>';

    if (t.sql) {
      h += '<div class="trace-section"><div class="trace-label">查询语句（只读 · 强制 LIMIT）</div>'
        + '<pre class="trace-sql">' + U.esc(t.sql) + '</pre></div>';
    }
    if (opt.extra && opt.extra.length) {
      h += '<div class="trace-section"><div class="trace-label">补充说明</div><div class="trace-chips">';
      opt.extra.forEach(function (x) { h += '<span class="tag">' + U.esc(x) + '</span>'; });
      h += '</div></div>';
    }
    h += '</div></div>';
    return h;
  }

  /** 绑定溯源面板折叠 */
  function bindTrace(host) {
    (host || document).querySelectorAll('.trace-head').forEach(function (el) {
      if (el.__bound) return;
      el.__bound = true;
      el.addEventListener('click', function () {
        el.parentNode.classList.toggle('open');
      });
    });
  }

  /* ============ 灰色角标 ============ */
  function aiBadge() {
    return '<span class="ai-badge">AI辅助 · 供参考</span>';
  }

  /**
   * 为含角标的卡片补上 has-badge 标记（:has() 不被支持时的兜底），
   * 使卡片头部右侧留出角标空间。
   */
  function markBadgedCards(host) {
    (host || document).querySelectorAll('.card').forEach(function (c) {
      if (c.querySelector(':scope > .ai-badge')) c.classList.add('has-badge');
    });
  }

  /* 内容变更后自动打标（轻量 MutationObserver） */
  function installBadgeMarker() {
    if (typeof MutationObserver === 'undefined') return;
    var scheduled = false;
    var obs = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; markBadgedCards(document); }, 30);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* 暴露到全局 */
  root.Wy = {
    store: store, api: {
      call: call, checkHealth: checkHealth, getMode: getMode, setMode: setMode,
      state: apiState, API_BASE: API_BASE
    },
    U: U, toast: toast, renderTable: renderTable, Chart: Chart,
    renderTrace: renderTrace, bindTrace: bindTrace, aiBadge: aiBadge,
    markBadgedCards: markBadgedCards, installBadgeMarker: installBadgeMarker
  };
})(window);
