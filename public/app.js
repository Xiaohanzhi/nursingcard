/* ============================================================
   专科知识卡平台 · 前端应用逻辑（数据来自后端 API）
   ============================================================ */
var TOKEN = localStorage.getItem('kc_token') || '';
var CURRENT_USER = null;
var CARDS = [];
var selectedFileId = '';
var selectedCardId = '';
var currentReviewTab = 'l1';
var currentReviewCard = null;
var currentTask = null;
var editingCardId = null;
var pollTimer = null;

var STATUS_MAP = { draft: '草稿', review1: '一级审核中', review2: '二级审核中', published: '已定稿', superseded: '已停用' };
var ROLE_MAP = { admin: '管理员', engineer: '知识工程师', reviewer1: '一审审核员', reviewer2: '二审审核员', viewer: '查看者' };
var TYPE_CLASS = {
  '护理问题卡': 'tag-purple',
  '评估卡': 'tag-blue',
  '风险预警卡': 'tag-red',
  '宣教卡': 'tag-green',
  '应急预案卡': 'tag-orange',
  '交接班卡': 'tag-gray',
  '随访卡': 'tag-blue'
};
function typeTagOf(t) { return TYPE_CLASS[t] || 'tag-gray'; }

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

/* ============ API ============ */
function api(path, opts) {
  opts = opts || {};
  var headers = opts.headers || {};
  headers['Authorization'] = 'Bearer ' + TOKEN;
  var cfg = { method: opts.method || 'GET', headers: headers, body: opts.body };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    cfg.body = JSON.stringify(opts.body);
  }
  return fetch('/api' + path, cfg).then(function (r) {
    return r.json().then(function (j) {
      if (r.status === 401) { showLogin(); throw new Error(j.error || '登录已过期'); }
      if (!r.ok) throw new Error(j.error || ('请求失败 ' + r.status));
      return j;
    });
  });
}

function showErr(e) { showToast((e && e.message) || '操作失败', 'error'); }

/* ============ 登录 ============ */
function showLogin() {
  TOKEN = '';
  localStorage.removeItem('kc_token');
  document.getElementById('loginPage').classList.remove('hidden');
}
function doLogin() {
  var u = document.getElementById('loginUser').value.trim();
  var p = document.getElementById('loginPass').value;
  document.getElementById('loginErr').textContent = '';
  api('/auth/login', { method: 'POST', body: { username: u, password: p } })
    .then(function (r) {
      TOKEN = r.token;
      CURRENT_USER = r.user;
      localStorage.setItem('kc_token', TOKEN);
      afterLogin();
    })
    .catch(function (e) { document.getElementById('loginErr').textContent = e.message; });
}
function logout() {
  TOKEN = '';
  CURRENT_USER = null;
  localStorage.removeItem('kc_token');
  showLogin();
}
function afterLogin() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('userName').textContent = CURRENT_USER.displayName;
  document.getElementById('userRole').textContent = ROLE_MAP[CURRENT_USER.role] || CURRENT_USER.role;
  document.getElementById('navSettings').style.display = CURRENT_USER.role === 'admin' ? '' : 'none';
  refreshAll();
}

/* ============ 页面导航 ============ */
function showPage(name) {
  if (name === 'settings' && CURRENT_USER && CURRENT_USER.role !== 'admin') {
    showToast('仅管理员可访问系统设置', 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var pg = document.getElementById('page-' + name);
  if (!pg) return;
  pg.classList.add('active');
  document.querySelectorAll('.sidebar .item').forEach(function (i) {
    i.classList.toggle('active', i.dataset.page === name);
  });
  var titles = {
    'card-list': '核心功能 / 卡片列表',
    'ai-workbench': '核心功能 / AI优化卡片',
    'literature': '核心功能 / 文献管理',
    'review-queue': '核心功能 / 卡片审核',
    'settings': '系统 / 系统设置'
  };
  document.getElementById('breadcrumb').innerHTML = (titles[name] || name).replace(/([^\/]+)$/, '<b>$1</b>');
  if (name === 'card-list') { loadCards(); }
  if (name === 'ai-workbench') { renderIterateCardList(); loadLiteratureOptions(); }
  if (name === 'literature') { loadLiterature(); }
  if (name === 'review-queue') { switchReviewTab(currentReviewTab); }
  if (name === 'settings') { loadSettings(); }
}
function refreshAll() {
  if (!CURRENT_USER) return;
  loadCards();
  var active = document.querySelector('.page.active');
  if (active && active.id === 'page-review-queue') switchReviewTab(currentReviewTab);
  if (active && active.id === 'page-settings') loadSettings();
  showToast('数据已刷新', 'success');
}
/* ============ 卡片列表 ============ */
function loadCards() {
  api('/cards').then(function (list) {
    CARDS = list;
    filterCards();
  }).catch(showErr);
}
function filterCards() {
  var status = document.getElementById('filterStatus').value;
  var isCommon = document.getElementById('filterCommon').value;
  var kw = document.getElementById('filterKeyword').value.toLowerCase();
  var data = CARDS.filter(function (c) {
    if (status && c.status !== status) return false;
    if (isCommon !== '' && String(c.isCommon) !== isCommon) return false;
    if (kw && c.name.toLowerCase().indexOf(kw) === -1 && c.questionName.toLowerCase().indexOf(kw) === -1) return false;
    return true;
  });
  renderCardList(data);
}
function renderCardList(data) {
  var tbody = document.getElementById('cardTableBody');
  var statusCls = { published: 'tag-green', review1: 'tag-orange', review2: 'tag-orange', draft: 'tag-gray' };
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📭</div><div>未找到匹配的卡片</div><div class="tip">试试调整筛选条件，或点击右上角"手动创建卡片"</div></div></td></tr>';
  } else {
    tbody.innerHTML = data.map(function (c) {
      var aiTag = c.aiGenerated ? ' <span class="tag tag-purple" style="font-size:10px">AI</span>' : '';
      return '<tr onclick="openCardDetail(\'' + c.id + '\')">' +
        '<td><a onclick="event.stopPropagation();openCardDetail(\'' + c.id + '\')">' + esc(c.name) + '</a>' + aiTag + '</td>' +
        '<td>' + esc(c.disease || '-') + '</td>' +
        '<td><span class="tag ' + (c.isCommon ? 'tag-blue' : 'tag-gray') + '">' + (c.isCommon ? '共性' : '专病') + '</span></td>' +
        '<td><code style="font-size:12px;color:var(--text2)">' + esc(c.version) + '</code></td>' +
        '<td><span class="tag ' + (statusCls[c.status] || 'tag-gray') + '">' + (STATUS_MAP[c.status] || c.status) + '</span></td>' +
        '<td style="font-size:12px;color:var(--text2)">' + esc(String(c.updatedAt || '').substr(0, 10)) + '<br><span style="font-size:11px;color:var(--text3)">' + esc(c.updaterName || '') + '</span></td>' +
        '<td><a onclick="event.stopPropagation();openCardDetail(\'' + c.id + '\')">详情</a></td>' +
        '</tr>';
    }).join('');
  }
  document.getElementById('totalCards').textContent = data.length;
  document.getElementById('stat-published').textContent = CARDS.filter(function (c) { return c.status === 'published'; }).length;
  document.getElementById('stat-reviewing').textContent = CARDS.filter(function (c) { return c.status === 'review1' || c.status === 'review2'; }).length;
  document.getElementById('stat-draft').textContent = CARDS.filter(function (c) { return c.status === 'draft'; }).length;
  updateReviewBadge();
}
function updateReviewBadge() {
  var n = CARDS.filter(function (c) { return c.status === 'review1' || c.status === 'review2'; }).length;
  document.getElementById('reviewBadge').textContent = n;
  document.getElementById('reviewBadge').style.display = n > 0 ? '' : 'none';
}
/* ============ 卡片详情 ============ */
function openCardDetail(id) {
  var c = CARDS.find(function (x) { return x.id === id; });
  if (!c) return;
  openCardDetailObj(c);
}
function openCardDetailObj(c) {
  currentReviewCard = c;
  document.getElementById('cardDetailTitle').textContent = c.name + '  —  ' + c.version;
  document.getElementById('cardDetailBody').innerHTML = renderCardDetail(c);
  renderDetailFooter(c);
  document.getElementById('cardDetailModal').classList.add('show');
}
function renderDetailFooter(c) {
  var footer = document.getElementById('cardDetailFooter');
  footer.innerHTML = '';
  if (c.status === 'draft') {
    footer.innerHTML += '<button class="btn btn-primary" onclick="editCardFromDetail()">编辑</button>';
    footer.innerHTML += '<button class="btn btn-warning" onclick="submitReviewFromDetail()">提交一审</button>';
    footer.innerHTML += '<button class="btn btn-danger" onclick="deleteCardFromDetail()">删除</button>';
  } else if (c.status === 'review1' || c.status === 'review2') {
    footer.innerHTML += '<button class="btn btn-primary" onclick="goReviewFromDetail()">进入审核</button>';
  } else if (c.status === 'published') {
    footer.innerHTML += '<button class="btn btn-primary" onclick="newVersionFromDetail()">新建版本</button>';
  }
  footer.innerHTML += '<button class="btn btn-default" onclick="showVersions(\'' + c.id + '\')">版本历史</button>';
}
function closeCardDetail() {
  document.getElementById('cardDetailModal').classList.remove('show');
}
function renderCardDetail(c) {
  var html = '';
  html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">' +
    '<span class="tag ' + typeTagOf(c.type) + '">' + esc(c.type) + '</span>' +
    '<span class="tag ' + (c.status === 'published' ? 'tag-green' : (c.status === 'superseded' ? 'tag-red' : (c.status === 'draft' ? 'tag-gray' : 'tag-orange'))) + '">' + (STATUS_MAP[c.status] || c.status) + '</span>' +
    (c.isCommon ? '<span class="tag tag-blue">共性</span>' : '<span class="tag tag-gray">专病</span>') +
    (c.aiGenerated ? '<span class="tag tag-purple">🤖 AI 迭代</span>' : '') +
    '</div>';
  html += c.type === '护理问题卡' ? renderReviewFields(c) : renderGenericFields(c);
  if (c.status === 'superseded') {
    var eff = CARDS.find(function (x) { return (x.lineId || x.id) === (c.lineId || c.id) && x.status === 'published'; });
    html += '<div class="field-note" style="color:var(--warning-text);margin-top:10px">已停用：本版本已被 ' + (eff ? esc(eff.version) : '新版本') + ' 替代，不再生效（仅可查看）。</div>';
  }
  if (c.aiSource) {
    html += '<div class="field-note" style="margin-top:10px">AI 来源：' + esc(c.aiSource) + '</div>';
  }
  if (c.rejectReason) {
    html += '<div class="field-note" style="margin-top:6px;color:var(--danger)">退回原因：' + esc(c.rejectReason) + '</div>';
  }
  if (c.refs && c.refs.length) {
    html += '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">' +
      '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">📖 引用来源</div>' +
      c.refs.map(function (r) {
        return '<div class="ref-item">' +
          '<div class="ref-title">' + esc(r.title) + ' — ' + esc(r.section || '') + '</div>' +
          '<div class="ref-excerpt">' + esc(r.excerpt) + '</div>' +
          '</div>';
      }).join('') +
      '</div>';
  }
  return html;
}
function renderGenericFields(c) {
  var html = '';
  html += '<div class="review-field">' +
    '<div class="field-label">关联病种</div>' +
    '<div class="field-final">' + esc(c.disease || '—') + '</div>' +
    '</div>';
  html += '<div class="review-field">' +
    '<div class="field-label">共性/专病</div>' +
    '<div class="field-final">' + (c.isCommon ? '共性（跨病种）' : '专病特有') + '</div>' +
    '</div>';
  return html;
}
function deleteCardFromDetail() {
  var c = currentReviewCard;
  if (!c) return;
  if (!confirm('确定删除草稿卡片「' + c.name + '」？删除后不可恢复。')) return;
  api('/cards/' + c.id, { method: 'DELETE' })
    .then(function () {
      closeCardDetail();
      showToast('已删除草稿卡片', 'success');
      loadCards();
    }).catch(showErr);
}
function editCardFromDetail() {
  var c = currentReviewCard;
  closeCardDetail();
  if (c) openEditCardModal(c); else showToast('未找到可编辑的卡片', 'error');
}
function submitReviewFromDetail() {
  var c = currentReviewCard;
  if (!c) return;
  api('/cards/' + c.id + '/submit-review', { method: 'POST', body: {} })
    .then(function () {
      closeCardDetail();
      showToast('已提交一级审核', 'success');
      loadCards();
    }).catch(showErr);
}
function newVersionFromDetail() {
  var c = currentReviewCard;
  if (!c) return;
  api('/cards/' + c.id + '/new-version', { method: 'POST', body: {} })
    .then(function (r) {
      closeCardDetail();
      showToast('已创建新版本草稿：' + r.version, 'success');
      loadCards();
    }).catch(showErr);
}
function goReviewFromDetail() {
  var c = currentReviewCard;
  closeCardDetail();
  showPage('review-queue');
  if (c) {
    var level = c.status === 'review1' ? 'l1' : 'l2';
    switchReviewTab(level);
    setTimeout(function () { openReviewPanel(c.id); }, 100);
  }
}
function showVersions(cardId) {
  api('/cards/' + cardId + '/versions').then(function (list) {
    var body = document.getElementById('versionsModalBody');
    if (!list.length) {
      body.innerHTML = '<div class="empty-state"><div>暂无版本记录</div></div>';
    } else {
      body.innerHTML = '<table><thead><tr><th>版本</th><th>状态</th><th>更新人</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
        list.map(function (v) {
          var stCls = v.status === 'published' ? 'tag-green' : (v.status === 'superseded' ? 'tag-red' : (v.status === 'draft' ? 'tag-gray' : 'tag-orange'));
          return '<tr>' +
            '<td><code style="font-size:12px;color:var(--text2)">' + esc(v.version) + '</code></td>' +
            '<td><span class="tag ' + stCls + '">' + (STATUS_MAP[v.status] || v.status) + '</span></td>' +
            '<td>' + esc(v.updaterName || '') + '</td>' +
            '<td style="font-size:12px;color:var(--text2)">' + esc(v.updatedAt || '') + '</td>' +
            '<td><a onclick="openCardVersion(\'' + v.id + '\')">查看</a></td>' +
            '</tr>';
        }).join('') + '</tbody></table>';
    }
    document.getElementById('versionsModal').classList.add('show');
  }).catch(showErr);
}
function closeVersionsModal() {
  document.getElementById('versionsModal').classList.remove('show');
}
function openCardVersion(id) {
  api('/cards/' + id).then(function (c) {
    closeVersionsModal();
    openCardDetailObj(c);
  }).catch(showErr);
}

/* ============ 创建 / 编辑卡片 ============ */
function openCreateCardModal() {
  editingCardId = null;
  document.getElementById('createCardModalTitle').textContent = '新建知识卡片';
  document.getElementById('saveCardBtn').textContent = '保存草稿';
  document.getElementById('newCardType').value = '护理问题卡';
  updateTypeFields();
  document.getElementById('newCardName').value = '';
  document.getElementById('newCardDisease').value = 'AMI';
  document.getElementById('newCardIsCommon').value = 'false';
  document.getElementById('nc_questionName').value = '';
  document.getElementById('nc_goal').value = '';
  document.getElementById('nc_triggerCond').value = '';
  resetMeasureEditor();
  resetRefEditor();
  document.getElementById('createCardModal').classList.add('show');
}
function openEditCardModal(c) {
  editingCardId = c.id;
  document.getElementById('createCardModalTitle').textContent = '编辑知识卡片';
  document.getElementById('saveCardBtn').textContent = '保存修改';
  document.getElementById('newCardType').value = c.type || '护理问题卡';
  updateTypeFields();
  document.getElementById('newCardName').value = c.name || '';
  document.getElementById('newCardDisease').value = c.disease || '';
  document.getElementById('newCardIsCommon').value = String(c.isCommon);
  document.getElementById('nc_questionName').value = c.questionName || '';
  document.getElementById('nc_goal').value = c.goal || '';
  document.getElementById('nc_triggerCond').value = c.triggerCond || '';
  resetMeasureEditor(c.measures);
  resetRefEditor(c.refs);
  document.getElementById('createCardModal').classList.add('show');
}
function closeCreateCardModal() {
  document.getElementById('createCardModal').classList.remove('show');
}
function updateTypeFields() {
  var t = document.getElementById('newCardType').value;
  var nursing = t === '护理问题卡';
  document.getElementById('nursingFieldsWrap').style.display = nursing ? '' : 'none';
  document.getElementById('nonNursingHint').style.display = nursing ? 'none' : '';
}
function resetMeasureEditor(measures) {
  var host = document.getElementById('measureEditor');
  host.innerHTML = '';
  if (measures && measures.length) {
    measures.forEach(function (m) { addMeasureRow(m); });
  } else {
    addMeasureRow();
  }
}
function addMeasureRow(data) {
  var host = document.getElementById('measureEditor');
  var row = document.createElement('div');
  row.className = 'measure-row';
  row.innerHTML =
    '<select class="ms-priority">' +
    '<option value="首优">首优</option>' +
    '<option value="次优">次优</option>' +
    '<option value="次次优">次次优</option>' +
    '<option value="多学科（辅助）">多学科（辅助）</option>' +
    '</select>' +
    '<input class="ms-name" placeholder="措施名称，如：休息与活动">' +
    '<textarea class="ms-activities" rows="2" placeholder="护理活动，每行一条，如：①绝对卧床"></textarea>' +
    '<button type="button" class="btn btn-sm btn-danger ms-del" onclick="removeMeasureRow(this)">✕</button>';
  host.appendChild(row);
  if (data) {
    row.querySelector('.ms-priority').value = data.priority || '首优';
    row.querySelector('.ms-name').value = data.name || '';
    row.querySelector('.ms-activities').value = (data.activities || []).join('\n');
  }
}
function removeMeasureRow(btn) {
  var host = document.getElementById('measureEditor');
  if (host.children.length <= 1) { showToast('至少保留一条护理措施', 'error'); return; }
  btn.closest('.measure-row').remove();
}
function collectMeasures() {
  var rows = document.querySelectorAll('#measureEditor .measure-row');
  var list = [];
  rows.forEach(function (r) {
    var priority = r.querySelector('.ms-priority').value;
    var name = r.querySelector('.ms-name').value.trim();
    var acts = r.querySelector('.ms-activities').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (name || acts.length) list.push({ priority: priority, name: name || '未命名措施', activities: acts });
  });
  return list;
}
function resetRefEditor(refs) {
  var host = document.getElementById('refEditor');
  host.innerHTML = '';
  (refs && refs.length ? refs : []).forEach(function (r) { addRefRow(r); });
}
function addRefRow(data) {
  var host = document.getElementById('refEditor');
  var row = document.createElement('div');
  row.className = 'ref-row';
  row.innerHTML =
    '<input class="rf-title" placeholder="文献标题（必填），如：2025 ACC/AHA ACS 指南">' +
    '<input class="rf-section" placeholder="章节，如：§4.2 疼痛管理">' +
    '<textarea class="rf-excerpt" rows="2" placeholder="摘录/关键内容（可选）"></textarea>' +
    '<button type="button" class="btn btn-sm btn-danger rf-del" onclick="removeRefRow(this)">✕</button>';
  host.appendChild(row);
  if (data) {
    row.querySelector('.rf-title').value = data.title || '';
    row.querySelector('.rf-section').value = data.section || '';
    row.querySelector('.rf-excerpt').value = data.excerpt || '';
  }
}
function removeRefRow(btn) {
  btn.closest('.ref-row').remove();
}
function collectRefs() {
  var list = [];
  document.querySelectorAll('#refEditor .ref-row').forEach(function (r) {
    var title = r.querySelector('.rf-title').value.trim();
    var section = r.querySelector('.rf-section').value.trim();
    var excerpt = r.querySelector('.rf-excerpt').value.trim();
    if (title) list.push({ title: title, section: section, excerpt: excerpt });
  });
  return list;
}
function saveNewCard() {
  var name = document.getElementById('newCardName').value.trim();
  if (!name) { showToast('请填写卡名称', 'error'); return; }
  var type = document.getElementById('newCardType').value;
  var questionName = document.getElementById('nc_questionName').value.trim();
  if (type === '护理问题卡' && !questionName) { showToast('请填写护理问题名称', 'error'); return; }
  var payload = {
    name: name,
    type: type,
    disease: document.getElementById('newCardDisease').value.trim(),
    isCommon: document.getElementById('newCardIsCommon').value === 'true',
    questionName: questionName,
    goal: document.getElementById('nc_goal').value.trim(),
    triggerCond: document.getElementById('nc_triggerCond').value.trim(),
    measures: type === '护理问题卡' ? collectMeasures() : [],
    refs: collectRefs()
  };
  var req = editingCardId
    ? api('/cards/' + editingCardId, { method: 'PUT', body: payload })
    : api('/cards', { method: 'POST', body: payload });
  req.then(function () {
    showToast(editingCardId ? '已保存修改：' + name : '已保存草稿：' + name + (type !== '护理问题卡' ? '（' + type + '，表单待完善）' : ''), 'success');
    closeCreateCardModal();
    loadCards();
  }).catch(showErr);
}

/* ============ 卡片审核 ============ */
function switchReviewTab(level, el) {
  currentReviewTab = level;
  document.querySelectorAll('.tab-item').forEach(function (t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  else document.querySelector('.tab-item[onclick*="' + level + '"]').classList.add('active');
  var title = level === 'l1' ? '一级待审核' : (level === 'l2' ? '二级待审核' : '已审核');
  var path = level === 'done' ? '/review/history' : '/review/pending?level=' + (level === 'l1' ? '1' : '2');
  api(path).then(function (list) {
    renderReviewList(list, title);
  }).catch(showErr);
}
function renderReviewList(list, title) {
  var tbody = document.getElementById('reviewTableBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">🎉</div><div>' + title + '队列已清空</div></div></td></tr>';
  } else {
    tbody.innerHTML = list.map(function (c) {
      return '<tr>' +
        '<td><a onclick="openReviewPanel(\'' + c.id + '\')">' + esc(c.name) + '</a></td>' +
        '<td><span class="tag ' + typeTagOf(c.type) + '">' + esc(c.type) + '</span></td>' +
        '<td><code style="font-size:12px;color:var(--text2)">' + esc(c.version) + '</code></td>' +
        '<td>' + esc(c.creatorName || '') + '</td>' +
        '<td style="font-size:12px;color:var(--text2)">' + esc(c.updatedAt || '') + '</td>' +
        '<td><button class="btn btn-sm btn-primary" onclick="openReviewPanel(\'' + c.id + '\')">进入审核</button></td>' +
        '</tr>';
    }).join('');
  }
  var l1 = CARDS.filter(function (c) { return c.status === 'review1'; }).length;
  var l2 = CARDS.filter(function (c) { return c.status === 'review2'; }).length;
  var done = CARDS.filter(function (c) { return c.status === 'published'; }).length;
  var rej = CARDS.filter(function (c) { return c.status === 'draft' && c.rejectReason; }).length;
  document.getElementById('cnt-l1').textContent = l1;
  document.getElementById('cnt-l2').textContent = l2;
  document.getElementById('cnt-done').textContent = done;
  document.getElementById('reviewStat-mine').textContent = l1 + l2;
  document.getElementById('reviewStat-done').textContent = done;
  document.getElementById('reviewStat-rejected').textContent = rej;
  document.getElementById('reviewStat-avg').innerHTML = '—<span style="font-size:13px;color:var(--text2);font-weight:400"> 天</span>';
}
var PRIORITY_CLASS = { '首优': 'tag-red', '次优': 'tag-orange', '次次优': 'tag-blue', '多学科（辅助）': 'tag-purple', '辅助': 'tag-purple' };
function renderMeasuresHtml(measures) {
  if (!measures || !measures.length) return '<div style="font-size:12px;color:var(--text3)">暂无推荐护理措施</div>';
  return measures.map(function (m, i) {
    return '<div style="margin-bottom:8px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm)">' +
      '<div class="field-label">措施 ' + (i + 1) + ' <span class="tag ' + (PRIORITY_CLASS[m.priority] || 'tag-gray') + '" style="font-size:10px;margin-left:4px">' + esc(m.priority) + '</span> <b>' + esc(m.name || '') + '</b></div>' +
      '<div style="font-size:13px;color:var(--text);line-height:1.7">' + esc((m.activities || []).join('；')) + '</div>' +
      '</div>';
  }).join('');
}
function renderReviewFields(c) {
  var html = '';
  var fieldDefs = [
    { key: 'disease', label: '关联病种' },
    { key: 'isCommon', label: '共性/专病' },
    { key: 'questionName', label: '护理问题名称' },
    { key: 'goal', label: '护理目标' },
    { key: 'triggerCond', label: '护理问题触发' }
  ];
  fieldDefs.forEach(function (fd) {
    var raw = c[fd.key];
    var val = fd.key === 'isCommon' ? (raw ? '共性（跨病种）' : '专病特有') : (raw || '—');
    html += '<div class="review-field">' +
      '<div class="field-label">' + fd.label + '</div>' +
      '<div class="field-final">' + esc(val) + '</div>' +
      '</div>';
  });
  html += '<div class="review-field">' +
    '<div class="field-label">推荐护理措施</div>' +
    '<div class="field-final" style="font-weight:400">' + renderMeasuresHtml(c.measures) + '</div>' +
    '</div>';
  return html;
}
function openReviewPanel(cardId) {
  var c = CARDS.find(function (x) { return x.id === cardId; });
  if (!c) return;
  currentReviewCard = c;
  var level = c.status === 'review1' ? '一级审核' : '二级审核';
  document.getElementById('reviewModalTitle').textContent = '🔍 ' + level + ' — ' + c.name;
  document.getElementById('reviewNextLabel').textContent = level === '一级审核' ? '二级审核' : '定稿';
  document.getElementById('reviewModalBody').innerHTML = renderReviewFields(c);
  document.getElementById('reviewRefBody').innerHTML = (c.refs && c.refs.length)
    ? c.refs.map(function (r) {
      return '<div class="ref-item">' +
        '<div class="ref-title">📄 ' + esc(r.title) + ' — ' + esc(r.section || '') + '</div>' +
        '<div class="ref-meta">来源：文献摘录</div>' +
        '<div class="ref-excerpt">' + esc(r.excerpt) + '</div>' +
        '</div>';
    }).join('')
    : '<div class="empty-state"><div>暂无原文引用</div></div>';
  document.getElementById('reviewComment').value = '';
  document.getElementById('reviewModal').classList.add('show');
}
function closeReviewModal() {
  document.getElementById('reviewModal').classList.remove('show');
  currentReviewCard = null;
}
function reviewAction(action) {
  if (!currentReviewCard) return;
  if (action === '退回') { openRejectModal(); return; }
  var c = currentReviewCard;
  var level = c.status === 'review1' ? 1 : 2;
  api('/cards/' + c.id + '/review', { method: 'POST', body: { level: level, action: 'approve', comment: '' } })
    .then(function (r) {
      showToast(level === 1 ? '一审通过，已转入二审队列' : '二审通过，已定稿发布（' + r.version + '）', 'success');
      closeReviewModal();
      loadCards();
      switchReviewTab(currentReviewTab);
    }).catch(showErr);
}
function openRejectModal() {
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('show');
}
function closeRejectModal() {
  document.getElementById('rejectModal').classList.remove('show');
}
function confirmReject() {
  if (!currentReviewCard) return;
  var reason = document.getElementById('rejectReason').value.trim();
  if (!reason) { showToast('请填写退回原因', 'error'); return; }
  var c = currentReviewCard;
  var level = c.status === 'review1' ? 1 : 2;
  api('/cards/' + c.id + '/review', { method: 'POST', body: { level: level, action: 'reject', comment: reason } })
    .then(function () {
      showToast('已退回：' + c.name, 'warn');
      closeRejectModal();
      closeReviewModal();
      loadCards();
      switchReviewTab(currentReviewTab);
    }).catch(showErr);
}

/* ============ AI 优化卡片 ============ */
function handleFileSelect(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  uploadToLibrary(f, function (r) {
    loadLiteratureOptions(r.id);
    input.value = '';
  });
}
function uploadToLibrary(f, afterUpload) {
  var fd = new FormData();
  fd.append('file', f);
  api('/literature', { method: 'POST', body: fd })
    .then(function (r) {
      if (afterUpload) afterUpload(r);
      showToast('上传成功：' + r.fileName, 'success');
    })
    .catch(function (e) { showErr(e); });
}
function selectLiterature() {
  selectedFileId = document.getElementById('aiLitSelect').value;
}
function loadLiteratureOptions(selectId) {
  api('/literature').then(function (list) {
    var sel = document.getElementById('aiLitSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 请选择文献库中的文献 --</option>' +
      list.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('');
    if (selectId) { sel.value = selectId; selectedFileId = selectId; }
  }).catch(showErr);
}
function handleLitFileSelect(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  uploadToLibrary(f, function () { loadLiterature(); input.value = ''; });
}
function loadLiterature() {
  var kw = document.getElementById('litKeyword').value.trim();
  api('/literature?keyword=' + encodeURIComponent(kw)).then(function (list) {
    var tbody = document.getElementById('literatureTableBody');
    document.getElementById('totalLiterature').textContent = list.length;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">📚</div><div>暂无文献，点击右上角"上传文献"</div></div></td></tr>';
    } else {
      tbody.innerHTML = list.map(function (f) {
        var size = f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB';
        return '<tr>' +
          '<td>' + esc(f.name) + '</td>' +
          '<td><span class="tag tag-gray">' + esc((f.ext || '').replace('.', '').toUpperCase()) + '</span></td>' +
          '<td>' + size + '</td>' +
          '<td>' + esc(f.creatorName || '') + '</td>' +
          '<td style="font-size:12px;color:var(--text2)">' + esc(f.uploadedAt) + '</td>' +
          '<td><a onclick="renameLiterature(\'' + f.id + '\')">重命名</a> | <a data-name="' + esc(f.name) + '" onclick="downloadLiterature(this,\'' + f.id + '\')">下载</a> | <a style="color:var(--danger)" onclick="deleteLiterature(\'' + f.id + '\')">删除</a></td>' +
          '</tr>';
      }).join('');
    }
  }).catch(showErr);
}
function downloadLiterature(el, id) {
  fetch('/api/literature/' + id + '/download', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(function (r) {
      if (!r.ok) throw new Error('下载失败');
      return r.blob();
    })
    .then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (el && el.getAttribute('data-name')) || ('文献_' + id);
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    })
    .catch(function () { showToast('下载失败', 'error'); });
}
function deleteLiterature(id) {
  if (!confirm('确定删除该文献？删除后不可恢复（已生成草稿中的引用文字不受影响）。')) return;
  api('/literature/' + id, { method: 'DELETE' })
    .then(function () {
      loadLiterature();
      loadLiteratureOptions();
      showToast('已删除文献', 'success');
    }).catch(showErr);
}
function renameLiterature(id) {
  var name = prompt('请输入新的文献名称（含扩展名，如：2025 ACC指南.pdf）：');
  if (!name || !name.trim()) return;
  api('/literature/' + id, { method: 'PUT', body: { name: name.trim() } })
    .then(function () {
      loadLiterature();
      loadLiteratureOptions();
      showToast('文献已重命名', 'success');
    }).catch(showErr);
}
function renderIterateCardList() {
  var kw = document.getElementById('iterateCardSearch') ? document.getElementById('iterateCardSearch').value.toLowerCase() : '';
  var list = CARDS.filter(function (c) {
    return (c.status === 'draft' || c.status === 'published') &&
      (!kw || c.name.toLowerCase().includes(kw) || c.questionName.toLowerCase().includes(kw));
  });
  var host = document.getElementById('iterateCardList');
  if (!host) return;
  if (!list.length) {
    host.innerHTML = '<div class="empty-state"><div>暂无可迭代的卡片</div></div>';
    return;
  }
  host.innerHTML = list.map(function (c) {
    return '<div class="card-select-item ' + (c.id === selectedCardId ? 'selected' : '') + '" data-id="' + c.id + '" onclick="selectIterateCard(this)">' +
      '<div class="csi-check">' + (c.id === selectedCardId ? '✓' : '') + '</div>' +
      '<div class="csi-name">' + esc(c.name) + '</div>' +
      '<div class="csi-meta"><span class="tag tag-purple">护理问题卡</span><span class="csi-version">' + esc(c.version) + '</span></div>' +
      '</div>';
  }).join('');
}
function selectIterateCard(item) {
  selectedCardId = item.dataset.id;
  renderIterateCardList();
}
function setAIStep(n, state) {
  for (var i = 1; i <= 3; i++) {
    var s = document.getElementById('step' + i);
    if (s) { s.classList.remove('active', 'done'); if (i === n) s.classList.add(state); }
  }
  for (var j = 1; j < 3; j++) {
    var line = document.getElementById('line' + j);
    if (line) line.classList.toggle('done', j < n);
  }
  document.getElementById('ai-step1-content').classList.toggle('collapsed', n !== 1);
  document.getElementById('ai-step2-content').classList.toggle('collapsed', n !== 2);
  document.getElementById('ai-step3-content').classList.toggle('collapsed', n !== 3);
}
function aiGotoStep1() { setAIStep(1, 'active'); }
function aiGotoStep2() {
  if (!selectedFileId) { showToast('请先上传文献文件', 'error'); return; }
  if (!selectedCardId) { showToast('请选择要迭代的目标卡片', 'error'); return; }
  setAIStep(2, 'active');
}
function aiStartExtract() {
  var prompt = document.getElementById('aiPromptText').value.trim();
  api('/extract', { method: 'POST', body: { fileId: selectedFileId, cardId: selectedCardId, prompt: prompt } })
    .then(function (r) {
      setAIStep(3, 'done');
      document.getElementById('step3').classList.add('active');
      document.getElementById('ai-step3-content').classList.remove('collapsed');
      document.getElementById('aiExtractActions').classList.add('collapsed');
    document.getElementById('aiExtractStatus').textContent = '优化中...';
      document.getElementById('aiExtractStatus').style.color = 'var(--info)';
      document.getElementById('aiExtractResult').innerHTML =
        '<div class="ai-loading"><div class="spinner"></div>' +
        '<div class="status">AI 正在调用 Dify 工作流...</div>' +
        '<div class="step-text">文件上传 → 工作流执行 → 结果解析</div></div>';
      currentTask = r;
      pollExtractTask(r.id);
    }).catch(showErr);
}
function pollExtractTask(id) {
  var n = 0;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function () {
    api('/extract/' + id)
      .then(function (task) {
        currentTask = task;
        if (task.status === 'completed') {
          clearInterval(pollTimer);
          document.getElementById('aiExtractStatus').textContent = '优化完成';
          document.getElementById('aiExtractStatus').style.color = 'var(--success)';
          renderExtractResult(task);
        } else if (task.status === 'failed') {
          clearInterval(pollTimer);
          document.getElementById('aiExtractStatus').textContent = '优化失败';
          document.getElementById('aiExtractStatus').style.color = 'var(--danger)';
          renderExtractFailed(task);
        } else {
          n++;
          if (n > 300) {
            clearInterval(pollTimer);
            showToast('优化超时，请稍后重试', 'error');
          }
        }
      })
      .catch(function (e) {
        clearInterval(pollTimer);
        showErr(e);
      });
  }, 2000);
}
function renderExtractFailed(task) {
  document.getElementById('aiExtractResult').innerHTML =
    '<div class="empty-state"><div class="icon">⚠️</div><div>优化失败</div><div class="tip">' + esc(task.error || '未知错误') + '</div></div>';
  document.getElementById('aiExtractActions').classList.remove('collapsed');
}
function renderExtractResult(task) {
  var host = document.getElementById('aiExtractResult');
  var r = task.result || {};
  if (r.structured && r.suggestions.length) {
    host.innerHTML = buildStructuredHtml(task, r);
  } else if (r.structured) {
    host.innerHTML = '<div class="empty-state"><div class="icon">📄</div><div>工作流返回结构化结果但无字段建议</div></div>';
  } else {
    host.innerHTML = buildTextHtml(task);
  }
  document.getElementById('aiExtractActions').classList.remove('collapsed');
}
function buildStructuredHtml(task, r) {
  var html = '<div class="legend">' +
    '<span><span class="dot" style="background:var(--warning)"></span>黄色=修改依据</span>' +
    '<span><span class="dot" style="background:var(--success)"></span>绿色=AI建议修改</span>' +
    '<span><span class="dot" style="background:var(--danger)"></span>红色=原始内容</span>' +
    '</div>';
  html += '<div class="iterate-compare">' +
    '<div class="ic-header">📋 目标卡片：<span class="ic-card-name">' + esc(task.cardName || '') + '</span>' +
    '<span class="tag tag-purple">护理问题卡</span>' +
    '</div><div class="ic-body">';
  r.suggestions.forEach(function (d, i) {
    var uid = 'iter_' + i;
    var isMeasures = d.field === '推荐护理措施';
    var oldVal = isMeasures ? (typeof d.old === 'string' ? d.old : JSON.stringify(d.old || [])) : (d.old || '');
    var newVal = isMeasures ? (typeof d.new === 'string' ? d.new : JSON.stringify(d.new || [])) : (d.new || '');
    var oldHtml = isMeasures ? measuresHtml(d.old) : esc(oldVal);
    var newHtml = isMeasures ? measuresHtml(d.new) : esc(newVal);
    html += '<div class="iterate-diff-row' + (isMeasures ? ' idr-measures' : '') + '" id="' + uid + '">' +
      '<div class="idr-field">' + esc(d.field || '') + '</div>' +
      '<div class="idr-original"><div class="idr-label">🔴 优化前</div><div class="idr-text">' + oldHtml + '</div></div>' +
      '<div class="idr-suggest"><div class="idr-label">🟢 AI 优化后</div><div class="idr-text">' + newHtml + '</div></div>' +
      '<div class="idr-reason"><div class="idr-label">📖 依据</div><div class="idr-text">' + esc(d.reason || '') + (d.ref ? '<br><br><small>📚 ' + esc(d.ref) + '</small>' : '') + '</div></div>' +
      '<div class="idr-edit">' +
      (isMeasures
        ? '<textarea rows="5" class="idr-json" id="' + uid + '_input">' + esc(newVal) + '</textarea><div class="hint" style="margin-top:4px">可手动微调 measures JSON</div>'
        : '<textarea rows="2" id="' + uid + '_input">' + esc(newVal) + '</textarea>') +
      '<div class="idr-actions">' +
      '<button class="accept" onclick="acceptIterateSuggestion(\'' + uid + '\')">✓ 采纳</button>' +
      '<button class="reject" onclick="rejectIterateSuggestion(\'' + uid + '\')">✕ 拒绝</button>' +
      '<button onclick="resetIterateInput(\'' + uid + '\')">↺</button>' +
      '</div></div></div>';
  });
  html += '</div></div>';
  if (r.refs && r.refs.length) {
    html += '<div class="card-title" style="margin-top:16px">📖 AI 引用来源</div>' +
      r.refs.map(function (x) {
        return '<div class="ref-item"><div class="ref-title">📄 ' + esc(x.title || '') + ' — ' + esc(x.section || '') + '</div>' +
          '<div class="ref-excerpt">' + esc(x.excerpt || '') + '</div></div>';
      }).join('');
  }
  return html;
}
function measuresHtml(measures) {
  if (typeof measures === 'string') {
    const t = String(measures).trim();
    if (t.startsWith('[')) {
      try { measures = JSON.parse(t); } catch (e) { measures = null; }
    } else if (t) {
      const parts = t.split(/[①②③④⑤⑥⑦⑧⑨⑩]/).map(s => s.trim()).filter(Boolean);
      return '<div class="idr-m-card">' +
        '<div class="idr-m-head"><b>措施内容</b></div>' +
        '<div class="idr-m-acts">' + esc(parts.length ? parts.join('；') : t) + '</div>' +
        '</div>';
    } else {
      measures = null;
    }
  }
  if (!Array.isArray(measures) || !measures.length) return '<div class="idr-m-empty">无措施</div>';
  return measures.map(function (m) {
    return '<div class="idr-m-card">' +
      '<div class="idr-m-head"><span class="tag ' + (PRIORITY_CLASS[m.priority] || 'tag-gray') + '">' + esc(m.priority || '') + '</span><b>' + esc(m.measure_name || m.name || '') + '</b></div>' +
      '<div class="idr-m-acts">' + esc((m.activities || []).join('；')) + '</div>' +
      '</div>';
  }).join('');
}
function buildTextHtml(task) {
  var hint = '';
  if (task.result && task.result.echoHint) {
    hint = '<div class="ai-warn">⚠️ 工作流疑似将输入卡片原样回显，未生成优化建议。请检查 Dify 工作流 LLM 节点：应按契约输出 result.suggestions（字段：goal/trigger_cond/measures，含 old/new/reason/ref）。</div>';
  } else if (task.result && task.result.jsonDetected) {
    hint = '<div class="ai-warn">⚠️ 工作流返回的是 JSON，但不符合优化建议契约（缺少 result.suggestions 或 result.optimization）。请检查 Dify 工作流 LLM 节点的输出格式。</div>';
  }
  return '<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
    '<div class="field-note">工作流返回非结构化内容，请人工整理后手动编辑卡片</div>' +
    '<button class="copy-btn" onclick="copyAiText()">复制全文</button>' +
    '</div>' + hint +
    '<div class="ai-raw-text" id="aiRawText">' + esc(task.resultRaw || '') + '</div>';
}
function copyAiText() {
  var el = document.getElementById('aiRawText');
  if (!el) return;
  var ta = document.createElement('textarea');
  ta.value = el.textContent;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('已复制 AI 返回文本', 'success'); } catch (e) { showToast('复制失败，请手动选择复制', 'error'); }
  document.body.removeChild(ta);
}
function acceptIterateSuggestion(uid) {
  var row = document.getElementById(uid);
  if (!row) return;
  row.classList.remove('rejected');
  row.classList.add('accepted');
  var input = document.getElementById(uid + '_input');
  if (input) input.disabled = false;
  showToast('已采纳建议', 'success');
}
function rejectIterateSuggestion(uid) {
  var row = document.getElementById(uid);
  if (!row) return;
  row.classList.remove('accepted');
  row.classList.add('rejected');
  var input = document.getElementById(uid + '_input');
  if (input) input.disabled = true;
  showToast('已拒绝此建议', 'warn');
}
function resetIterateInput(uid) {
  var row = document.getElementById(uid);
  var input = document.getElementById(uid + '_input');
  if (!row || !input) return;
  row.classList.remove('accepted', 'rejected');
  input.disabled = false;
  showToast('已重置', 'info');
}
function aiConfirmDraft() {
  if (!currentTask) return;
  var accepted = [];
  document.querySelectorAll('.iterate-diff-row').forEach(function (row) {
    var input = document.getElementById(row.id + '_input');
    var fieldEl = row.querySelector('.idr-field');
    if (!input || row.classList.contains('rejected')) return;
    accepted.push({ field: fieldEl ? fieldEl.textContent.trim() : '', new: input.value });
  });
  api('/extract/' + currentTask.id + '/confirm', { method: 'POST', body: { accepted: accepted } })
    .then(function (r) {
      showToast('已生成草稿卡片：' + (r.name || ''), 'success');
      currentTask = null;
      setTimeout(function () { showPage('card-list'); }, 800);
    }).catch(showErr);
}

/* ============ 系统设置 ============ */
function loadSettings() {
  api('/settings').then(function (s) {
    document.getElementById('setDifyBase').value = s.dify.baseUrl || '';
    document.getElementById('setWorkflowId').value = s.dify.workflowId || '';
    document.getElementById('setTimeoutMs').value = s.dify.timeoutMs || 120000;
    document.getElementById('setOutputVar').value = s.dify.outputVar || 'output';
    document.getElementById('setInFile').value = s.dify.inputNames.file || 'file';
    document.getElementById('setInCard').value = s.dify.inputNames.card || 'card';
    document.getElementById('setInPrompt').value = s.dify.inputNames.prompt || 'prompt';
    document.getElementById('setMaxSize').value = s.files.maxSizeMb || 20;
    document.getElementById('setTtl').value = s.files.ttlHours || 24;
    document.getElementById('setExts').value = (s.files.allowedExtensions || []).join(',');
    document.getElementById('setDifyKey').value = '';
    var state = document.getElementById('setApiKeyState');
    state.textContent = s.dify.hasApiKey ? '已配置' : '未配置';
    state.className = 'tag ' + (s.dify.hasApiKey ? 'tag-green' : 'tag-red');
    document.getElementById('setApiKeyHint').textContent = s.dify.hasApiKey ? '当前密钥：' + s.dify.apiKeyMasked + '（输入新值可覆盖）' : '';
  }).catch(showErr);
}
function saveSettings() {
  var payload = {
    dify: {
      baseUrl: document.getElementById('setDifyBase').value.trim(),
      apiKey: document.getElementById('setDifyKey').value.trim(),
      workflowId: document.getElementById('setWorkflowId').value.trim(),
      timeoutMs: parseInt(document.getElementById('setTimeoutMs').value, 10) || 120000,
      outputVar: document.getElementById('setOutputVar').value.trim() || 'output',
      inputNames: {
        file: document.getElementById('setInFile').value.trim() || 'file',
        card: document.getElementById('setInCard').value.trim() || 'card',
        prompt: document.getElementById('setInPrompt').value.trim() || 'prompt'
      }
    },
    files: {
      maxSizeMb: parseInt(document.getElementById('setMaxSize').value, 10) || 20,
      ttlHours: parseInt(document.getElementById('setTtl').value, 10) || 24,
      allowedExtensions: document.getElementById('setExts').value.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean)
    }
  };
  api('/settings', { method: 'PUT', body: payload })
    .then(function (r) {
      showToast('设置已保存', 'success');
      if (r.portChanged) showToast('端口修改需重启服务生效', 'warn');
      loadSettings();
    }).catch(showErr);
}
function testDify() {
  document.getElementById('setDifyTestResult').textContent = '正在测试连接...';
  document.getElementById('setDifyTestResult').style.color = 'var(--text2)';
  api('/settings/test-dify', { method: 'POST', body: {} })
    .then(function (r) {
      document.getElementById('setDifyTestResult').textContent = '✅ ' + r.message;
      document.getElementById('setDifyTestResult').style.color = 'var(--success)';
    })
    .catch(function (e) {
      document.getElementById('setDifyTestResult').textContent = '❌ ' + e.message;
      document.getElementById('setDifyTestResult').style.color = 'var(--danger)';
    });
}
function changePassword() {
  var oldP = document.getElementById('pwOld').value;
  var newP = document.getElementById('pwNew').value;
  if (!oldP || !newP) { showToast('请填写原密码与新密码', 'error'); return; }
  api('/auth/password', { method: 'PUT', body: { oldPassword: oldP, newPassword: newP } })
    .then(function () {
      showToast('密码已修改', 'success');
      document.getElementById('pwOld').value = '';
      document.getElementById('pwNew').value = '';
    }).catch(showErr);
}

/* ============ 工具 ============ */
function showToast(msg, type) {
  var host = document.getElementById('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-' + type : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(function () { el.remove(); }, 2800);
}

/* ============ 初始化 ============ */
document.addEventListener('DOMContentLoaded', function () {
  function bindDropzone(dzId, afterUpload) {
    var dz = document.getElementById(dzId);
    if (!dz) return;
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadToLibrary(f, afterUpload);
    });
  }
  bindDropzone('dropzone', function (r) { loadLiteratureOptions(r.id); });
  bindDropzone('litDropzone', function () { loadLiterature(); });
  document.getElementById('loginPass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('loginUser').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  if (TOKEN) {
    api('/auth/me')
      .then(function (u) {
        CURRENT_USER = u;
        afterLogin();
      })
      .catch(function () { showLogin(); });
  } else {
    showLogin();
  }
});
