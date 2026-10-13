const page = document.body.dataset.adminPage;
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const {redirectOnUnauthorized = true, ...fetchOptions} = options;
  const response = await fetch(url, {cache:'no-store', ...fetchOptions});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && page === 'dashboard' && redirectOnUnauthorized) location.replace('/admin/login');
    const detail = data.detail;
    const message = typeof detail === 'string' ? detail : (detail?.message || data.message || '请求失败');
    const error = new Error(message);
    error.status = response.status;
    error.code = data.code || (typeof detail === 'object' ? detail?.code : '') || '';
    error.payload = data;
    throw error;
  }
  return data;
}

function showMessage(message, success = false) {
  const node = $('#authMessage');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('success', success);
}

async function initLogin() {
  const status = await api('/api/admin/auth/status');
  if (status.authenticated) {
    location.replace('/admin');
    return;
  }
  const setup = status.setup_required;
  $('#authEyebrow').textContent = setup ? 'FIRST RUN SETUP' : 'ADMIN ACCESS';
  $('#authTitle').textContent = setup ? '创建管理员账号' : '管理员登录';
  $('#authDescription').textContent = setup ? '此账号独立于普通用户，仅用于管理后台。' : '使用独立管理员账号进入用户与额度管理后台。';
  $('#confirmRow').hidden = !setup;
  $('#authSubmit').textContent = setup ? '创建并进入后台' : '登录管理后台';
  $('#adminPassword').autocomplete = setup ? 'new-password' : 'current-password';
  $('#adminAuthForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#adminUsername').value.trim();
    const password = $('#adminPassword').value;
    if (setup && password !== $('#adminConfirm').value) {
      showMessage('两次输入的密码不一致。');
      return;
    }
    $('#authSubmit').disabled = true;
    try {
      await api(setup ? '/api/admin/auth/setup' : '/api/admin/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password})
      });
      showMessage('验证成功，正在进入后台…', true);
      setTimeout(() => location.replace('/admin'), 180);
    } catch (error) {
      showMessage(error.message);
      $('#authSubmit').disabled = false;
    }
  });
}

let currentRange = {from:null, to:null};
let currentUsers = [];
let currentUsage = [];
let currentAdmin = '';
let currentRole = 'admin';
let currentPermissions = [];
let selectedUser = null;
let currentSection = 'users';
let currentShareMonth = '';
let currentAnalyticsRange = {from:null, to:null};
let currentAnalyticsMetric = 'tasks';
let currentAnalyticsData = null;

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.hidden = true, 2800);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function setPreset(value) {
  const now = new Date();
  if (value === 'all') currentRange = {from:null, to:null};
  else if (value === 'today') currentRange = {from:startOfDay(now).getTime(), to:null};
  else {
    const from = startOfDay(now);
    from.setDate(from.getDate() - Number(value) + 1);
    currentRange = {from:from.getTime(), to:null};
  }
  document.querySelectorAll('[data-range]').forEach(button => button.classList.toggle('active', button.dataset.range === value));
  $('#fromDate').value = currentRange.from ? dateInputValue(new Date(currentRange.from)) : '';
  $('#toDate').value = '';
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function query(includeUserFilters = false) {
  const params = new URLSearchParams();
  if (currentRange.from != null) params.set('from_ms', String(currentRange.from));
  if (currentRange.to != null) params.set('to_ms', String(currentRange.to));
  if (includeUserFilters) {
    const search = $('#userSearch').value.trim();
    const status = $('#statusFilter').value;
    const role = $('#roleFilter')?.value || '';
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (role) params.set('role', role);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function usageQuery(includeFilters = true) {
  const params = new URLSearchParams();
  if (currentRange.from != null) params.set('from_ms', String(currentRange.from));
  if (currentRange.to != null) params.set('to_ms', String(currentRange.to));
  if (includeFilters) {
    const search = $('#usageSearch')?.value.trim() || '';
    const category = $('#usageCategoryFilter')?.value || '';
    const status = $('#usageStatusFilter')?.value || '';
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (status) params.set('status', status);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function shareQuery(includeSearch = true) {
  const params = new URLSearchParams({month: currentShareMonth});
  const search = includeSearch ? ($('#shareSearch')?.value.trim() || '') : '';
  if (search) params.set('search', search);
  return `?${params.toString()}`;
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).format(new Date(Number(value)));
}

function statusLabel(status) {
  return {pending:'待审核', enabled:'已启用', disabled:'已禁用'}[status] || status;
}

function usageStatusLabel(status) {
  return {reserved:'处理中', succeeded:'成功', failed:'失败', refunded:'已退还'}[status] || status || '—';
}

function roleLabel(role) {
  return {super_admin:'超级管理员', admin:'管理员', user:'用户'}[role] || role;
}

function renderOverview(data) {
  const users = data.users || {};
  const usage = data.usage || {};
  $('#metricUsers').textContent = users.total || 0;
  $('#metricUserStatus').textContent = `待审核 ${users.pending || 0} · 已禁用 ${users.disabled || 0}`;
  $('#metricAvailable').textContent = users.available || 0;
  $('#metricReserved').textContent = `预占 ${users.reserved || 0}`;
  $('#metricSuccess').textContent = usage.success_tasks || 0;
  $('#metricFailed').textContent = `失败 ${usage.failed_tasks || 0}`;
  $('#metricPoints').textContent = usage.points_used || 0;
  $('#metricOutputs').textContent = `图片产出 ${usage.image_outputs || 0}`;
  $('#categoryImage').textContent = usage.image_tasks || 0;
  $('#categoryVideo').textContent = usage.video_tasks || 0;
  $('#categoryChat').textContent = usage.chat_tasks || 0;
  $('#categoryWorkflow').textContent = usage.workflow_tasks || 0;
  renderFeatureUsage(data.features || []);
}

function renderFeatureUsage(features) {
  const grid = $('#featureUsageGrid');
  const empty = $('#emptyFeatures');
  if (!grid || !empty) return;
  empty.hidden = features.length > 0;
  grid.innerHTML = features.map(item => `
    <article class="feature-usage-item">
      <div class="feature-usage-head">
        <span class="feature-surface">${escapeHtml(item.surface_label || '其他功能')}</span>
        <strong>${Number(item.points_used || 0)} <small>积分</small></strong>
      </div>
      <h3>${escapeHtml(item.feature_label || item.operation || '未知功能')}</h3>
      <p>${Number(item.success_tasks || 0)} 次成功 · ${Number(item.output_units || 0)} 个产出${Number(item.failed_tasks || 0) ? ` · ${Number(item.failed_tasks)} 次失败` : ''}</p>
    </article>`).join('');
}

function renderUsers() {
  $('#userCountLabel').textContent = `共 ${currentUsers.length} 位用户`;
  $('#emptyUsers').hidden = currentUsers.length > 0;
  const canManageRoles = currentPermissions.includes('manage_roles');
  const enabledSuperAdmins = currentUsers.filter(user => user.role === 'super_admin' && user.status === 'enabled').length;
  $('#usersBody').innerHTML = currentUsers.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.username)}</strong><span class="subtext">注册 ${formatTime(user.created_at)}</span></td>
      <td>${canManageRoles && user.role !== 'super_admin' ? `
        <select class="role-select" data-user-role="${user.id}" aria-label="修改 ${escapeHtml(user.username)} 的角色">
          ${['admin','user'].map(role => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
        </select>` : `<span class="status-pill">${roleLabel(user.role)}</span>`}</td>
      <td><span class="status-pill status-${user.status}">${statusLabel(user.status)}</span></td>
      <td><strong>${user.available_points}</strong><span class="subtext">历史余额 ${Number(user.historical_balance || 0)} · 处理中 ${user.reserved_points}</span><span class="subtext">历史实扣 ${Number(user.points_used || 0)} · 返还 ${Number(user.points_refunded || 0)}</span></td>
      <td><strong>任务 ${user.image_tasks}</strong><span class="subtext">产出 ${user.image_outputs}</span></td>
      <td><strong>任务 ${user.video_tasks}</strong><span class="subtext">产出 ${user.video_outputs}</span></td>
      <td><strong>任务 ${user.chat_tasks}</strong><span class="subtext">产出 ${user.chat_outputs}</span></td>
      <td><strong>任务 ${user.workflow_tasks}</strong><span class="subtext">产出 ${user.workflow_outputs}</span></td><td><strong>失败 ${user.failed_tasks}</strong></td>
      <td>${formatTime(user.last_active_at || user.last_login_at)}</td>
      <td><div class="row-actions">
        ${user.status !== 'enabled'
          ? `<button class="mini-btn primary" data-user-status="${user.id}:enabled" ${currentRole !== 'super_admin' && user.role === 'super_admin' ? 'disabled' : ''}>允许</button>`
          : `<button class="mini-btn danger" data-user-status="${user.id}:disabled" ${(currentRole !== 'super_admin' && user.role === 'super_admin') || (user.role === 'super_admin' && enabledSuperAdmins <= 1) ? 'disabled' : ''}>禁用</button>`}
        <button class="mini-btn" data-user-credit="${user.id}" ${currentRole !== 'super_admin' && user.role === 'super_admin' ? 'disabled' : ''}>积分</button>
      </div></td>
    </tr>`).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function renderUsage() {
  $('#usageCountLabel').textContent = `最近 ${currentUsage.length} 条记录`;
  $('#emptyUsage').hidden = currentUsage.length > 0;
  $('#usageBody').innerHTML = currentUsage.map(item => {
    const status = String(item.status || '');
    const taskDetail = item.error || item.external_task_id || item.id || '—';
    const refunded = Number(item.refunded_points || 0);
    const debited = Number(item.debited_points || 0);
    const charged = Number(item.charged_points || 0);
    const accountingLabel = status === 'reserved'
      ? `已扣 ${debited}`
      : status === 'failed' || status === 'refunded'
        ? refunded > 0 ? `已返还 ${refunded}` : '未扣费'
        : refunded > 0 ? `实扣 ${charged} · 返还 ${refunded}` : `实扣 ${charged}`;
    return `
      <tr>
        <td>${formatTime(item.created_at)}<span class="subtext">${item.completed_at ? `完成 ${formatTime(item.completed_at)}` : '尚未完成'}</span></td>
        <td><strong>${escapeHtml(item.username || '—')}</strong></td>
        <td><strong>${escapeHtml(item.feature_label || item.operation || '未知功能')}</strong><span class="subtext">${escapeHtml(item.surface_label || '其他入口')} · ${escapeHtml(item.operation || '—')}</span></td>
        <td><span class="category-pill category-${escapeHtml(item.category || '')}">${escapeHtml(item.category_label || item.category || '—')}</span></td>
        <td>${escapeHtml(item.model || '—')}</td>
        <td><span class="status-pill usage-status-${escapeHtml(status)}">${escapeHtml(item.status_label || usageStatusLabel(status))}</span><span class="subtext">${accountingLabel}</span></td>
        <td>${Number(item.output_units || 0)}<span class="subtext">请求 ${Number(item.requested_units || item.task_count || 0)}</span></td>
        <td>${Number(item.unit_cost || 0)}</td>
        <td><strong class="${Number(item.charged_points || 0) > 0 ? 'points-used' : ''}">${Number(item.charged_points || 0)}</strong><span class="subtext">扣款 ${debited} · 返还 ${refunded}</span></td>
        <td class="usage-detail-cell" title="${escapeHtml(taskDetail)}">${escapeHtml(taskDetail)}</td>
      </tr>`;
  }).join('');
}

function shareMonthValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit'}).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function setShareMonth(value) {
  currentShareMonth = value || shareMonthValue();
  $('#shareMonth').value = currentShareMonth;
  const latest = $('#shareMonth').max;
  $('#nextShareMonth').disabled = Boolean(latest && currentShareMonth >= latest);
}

function shiftShareMonth(offset) {
  const [year, month] = currentShareMonth.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  setShareMonth(`${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`);
}

function renderShareDailyChart(days) {
  const chart = $('#shareDailyChart');
  const safeDays = Array.isArray(days) ? days : [];
  chart.style.setProperty('--share-days', String(safeDays.length || 31));
  const peak = Math.max(0, ...safeDays.map(item => Number(item.count || 0)));
  $('#sharePeakLabel').textContent = `峰值 ${peak} 次`;
  chart.innerHTML = safeDays.map(item => {
    const count = Number(item.count || 0);
    const height = peak && count ? Math.max(8, Math.round(count / peak * 100)) : 0;
    const showDay = item.day === 1 || item.day % 5 === 0 || item.day === safeDays.length;
    return `<div class="share-day${count ? ' has-share' : ''}" title="${item.day} 日 · ${count} 次">
      <span>${count || ''}</span><i style="--share-height:${height}%"></i><small>${showDay ? item.day : ''}</small>
    </div>`;
  }).join('');
}

function renderShareStatistics(data) {
  const summary = data.summary || {};
  const designers = Array.isArray(data.designers) ? data.designers : [];
  $('#shareTotal').textContent = Number(summary.total_shares || 0);
  $('#shareMonthLabel').textContent = data.month_label || currentShareMonth;
  $('#shareActiveDesigners').textContent = Number(summary.active_designers || 0);
  $('#shareDesignerTotal').textContent = `共 ${Number(summary.total_designers || 0)} 位设计师`;
  $('#shareAverage').textContent = Number(summary.average_shares || 0).toFixed(1);
  $('#shareTopCount').textContent = Number(summary.top_share_count || 0);
  $('#shareTopDesigner').textContent = summary.top_designer ? `${summary.top_designer} · 分享最多` : '暂无分享';
  $('#shareCountLabel').textContent = `显示 ${designers.length} 位 · ${data.month_label || currentShareMonth}`;
  $('#emptyShares').hidden = designers.length > 0;
  $('#sharesBody').innerHTML = designers.map(designer => {
    const categories = Object.entries(designer.categories || {})
      .filter(([,count]) => Number(count) > 0)
      .map(([category,count]) => `<span class="share-category-chip">${escapeHtml(category)} ${Number(count)}</span>`)
      .join('') || '<span class="subtext no-share">本月暂无分享</span>';
    const count = Number(designer.share_count || 0);
    const rate = Number(designer.share_rate || 0);
    const status = ['pending','enabled','disabled'].includes(designer.status) ? designer.status : 'unknown';
    return `<tr class="${count ? '' : 'share-zero-row'}">
      <td><span class="share-rank${designer.rank && designer.rank <= 3 ? ' is-top' : ''}">${designer.rank || '—'}</span></td>
      <td><div class="designer-cell"><span class="designer-avatar">${escapeHtml(String(designer.username || '用').slice(0,1))}</span><div><strong>${escapeHtml(designer.username || '用户')}</strong><span class="subtext">${escapeHtml(roleLabel(designer.role || 'user'))}</span></div></div></td>
      <td><span class="status-pill status-${status}">${escapeHtml(status === 'unknown' ? '历史账号' : statusLabel(status))}</span></td>
      <td><strong class="share-count-value">${count}</strong><span class="subtext">次</span></td>
      <td><div class="share-rate"><span><i style="width:${Math.min(100, Math.max(0, rate))}%"></i></span><b>${rate.toFixed(1)}%</b></div></td>
      <td><div class="share-category-list">${categories}</div></td>
      <td>${count ? formatTime(designer.last_shared_at) : '—'}</td>
    </tr>`;
  }).join('');
  renderShareDailyChart(data.daily_totals || []);
}

async function loadShareStatistics() {
  const refresh = $('#refreshShares');
  refresh.disabled = true;
  try {
    const data = await api(`/api/admin/shares${shareQuery()}`);
    renderShareStatistics(data);
  } finally {
    refresh.disabled = false;
  }
}

function shanghaiDateValue(timestamp = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shanghaiMidnightMs(value) {
  return Date.parse(`${value}T00:00:00+08:00`);
}

function shiftShanghaiDate(value, days) {
  return shanghaiDateValue(shanghaiMidnightMs(value) + days * 86400000);
}

function setAnalyticsPreset(preset) {
  const today = shanghaiDateValue();
  const days = preset === 'today' ? 1 : Number(preset || 7);
  const from = shiftShanghaiDate(today, -(days - 1));
  currentAnalyticsRange = {from: shanghaiMidnightMs(from), to: shanghaiMidnightMs(shiftShanghaiDate(today, 1))};
  $('#analyticsFromDate').value = from;
  $('#analyticsToDate').value = today;
  document.querySelectorAll('[data-analytics-range]').forEach(button => button.classList.toggle('active', button.dataset.analyticsRange === preset));
}

function analyticsQuery() {
  const params = new URLSearchParams();
  if (currentAnalyticsRange.from != null) params.set('from_ms', currentAnalyticsRange.from);
  if (currentAnalyticsRange.to != null) params.set('to_ms', currentAnalyticsRange.to);
  return params.toString() ? `?${params}` : '';
}

function analyticsNumber(value) {
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2}).format(Number(value || 0));
}

function analyticsPercent(value) {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
}

function analyticsDuration(value) {
  const ms = Number(value || 0);
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${(ms / 60000).toFixed(1)} 分`;
}

function renderAnalyticsChange(id, comparison, isRate = false) {
  const target = $(id);
  if (!target) return;
  const current = Number(comparison?.current || 0);
  const previous = Number(comparison?.previous || 0);
  let label = '与上期持平';
  let tone = 'flat';
  if (comparison?.is_new) {
    label = '较上期新增';
    tone = 'up';
  } else if (isRate && current !== previous) {
    const delta = current - previous;
    label = `较上期${delta > 0 ? '提升' : '下降'} ${Math.abs(delta).toFixed(1)} 个百分点`;
    tone = delta > 0 ? 'up' : 'down';
  } else if (Number.isFinite(Number(comparison?.change_percent)) && Number(comparison.change_percent) !== 0) {
    const change = Number(comparison.change_percent);
    label = `较上期${change > 0 ? '增加' : '减少'} ${Math.abs(change).toFixed(1)}%`;
    tone = change > 0 ? 'up' : 'down';
  }
  target.textContent = label;
  target.dataset.tone = tone;
  target.classList.remove('is-up', 'is-down', 'is-flat');
  target.classList.add(`is-${tone}`);
}

function renderAnalyticsTrend(series) {
  const svg = $('#analyticsTrendChart');
  const rows = Array.isArray(series) ? series : [];
  if (!rows.length) {
    svg.innerHTML = '<text x="480" y="150" text-anchor="middle" class="analytics-svg-empty">暂无趋势数据</text>';
    return;
  }
  const width = 960;
  const height = 300;
  const plot = {left: 54, top: 24, right: 24, bottom: 46};
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  let keys;
  let colors;
  if (currentAnalyticsMetric === 'output') {
    keys = ['output_units']; colors = ['#7c5cff'];
  } else if (currentAnalyticsMetric === 'points') {
    keys = ['charged_points', 'reserved_points']; colors = ['#3982f7', '#f4a72c'];
  } else {
    keys = ['succeeded_tasks', 'failed_tasks', 'processing_tasks']; colors = ['#25a56a', '#e85b62', '#f4a72c'];
  }
  const totals = rows.map(row => keys.reduce((sum, key) => sum + Number(row[key] || 0), 0));
  const maxValue = Math.max(1, ...totals);
  const slot = plotWidth / rows.length;
  const barWidth = Math.max(8, Math.min(34, slot * 0.56));
  const parts = [];
  for (let step = 0; step <= 4; step += 1) {
    const y = plot.top + plotHeight - (plotHeight * step / 4);
    const value = maxValue * step / 4;
    parts.push(`<line x1="${plot.left}" y1="${y}" x2="${width - plot.right}" y2="${y}" class="analytics-grid-line"/>`);
    parts.push(`<text x="${plot.left - 10}" y="${y + 4}" text-anchor="end" class="analytics-axis-label">${analyticsNumber(value)}</text>`);
  }
  rows.forEach((row, index) => {
    const x = plot.left + slot * index + (slot - barWidth) / 2;
    let stacked = 0;
    keys.forEach((key, keyIndex) => {
      const value = Number(row[key] || 0);
      const barHeight = plotHeight * value / maxValue;
      const y = plot.top + plotHeight - stacked - barHeight;
      if (barHeight > 0) parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${colors[keyIndex]}"/>`);
      stacked += barHeight;
    });
    const label = String(row.date || '').slice(5).replace('-', '/');
    const showLabel = rows.length <= 10 || index % Math.ceil(rows.length / 8) === 0 || index === rows.length - 1;
    if (showLabel) parts.push(`<text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" class="analytics-axis-label">${escapeHtml(label)}</text>`);
  });
  const legendLabels = currentAnalyticsMetric === 'tasks' ? ['成功', '失败', '处理中'] : currentAnalyticsMetric === 'points' ? ['实扣', '预占'] : ['产出'];
  legendLabels.forEach((label, index) => parts.push(`<g transform="translate(${plot.left + index * 88},8)"><circle r="5" cx="5" cy="5" fill="${colors[index]}"/><text x="15" y="9" class="analytics-axis-label">${label}</text></g>`));
  svg.innerHTML = parts.join('');
}

function emptyTableRow(columns, message = '暂无数据') {
  return `<tr><td colspan="${columns}" class="analytics-empty-row">${escapeHtml(message)}</td></tr>`;
}

function analyticsTimestamp(value) {
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) && numeric > 0 ? numeric : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function renderAnalytics(data) {
  currentAnalyticsData = data;
  const summary = data.summary || {};
  const comparison = data.comparison || {};
  $('#analyticsActiveUsers').textContent = analyticsNumber(summary.active_users);
  $('#analyticsSucceeded').textContent = analyticsNumber(summary.succeeded_tasks);
  $('#analyticsOutputs').textContent = analyticsNumber(summary.output_units);
  $('#analyticsCharged').textContent = analyticsNumber(summary.charged_points);
  $('#analyticsSuccessRate').textContent = analyticsPercent(summary.success_rate);
  $('#analyticsProcessing').textContent = analyticsNumber(summary.processing_tasks);
  $('#analyticsReserved').textContent = analyticsNumber(summary.reserved_points);
  renderAnalyticsChange('#analyticsActiveUsersChange', comparison.active_users);
  renderAnalyticsChange('#analyticsSucceededChange', comparison.succeeded_tasks);
  renderAnalyticsChange('#analyticsOutputsChange', comparison.output_units);
  renderAnalyticsChange('#analyticsChargedChange', comparison.charged_points);
  renderAnalyticsChange('#analyticsSuccessRateChange', comparison.success_rate, true);
  renderAnalyticsChange('#analyticsProcessingChange', comparison.processing_tasks);
  renderAnalyticsChange('#analyticsReservedChange', comparison.reserved_points);
  renderAnalyticsTrend(data.series || []);

  const features = data.by_feature || [];
  $('#analyticsFeatureBody').innerHTML = features.length ? features.map(row => `<tr><td><strong>${escapeHtml(row.category_label || row.category || '未分类')}</strong><span class="subtext">${escapeHtml(row.operation || row.feature || '未记录')}</span></td><td>${analyticsNumber(row.tasks)}</td><td>${analyticsNumber(row.output_units)}</td><td>${analyticsNumber(row.charged_points)}</td><td>${analyticsPercent(row.success_rate)}</td></tr>`).join('') : emptyTableRow(5);
  const models = data.by_model || [];
  $('#analyticsModelBody').innerHTML = models.length ? models.map(row => `<tr><td><strong>${escapeHtml(row.model || '未记录')}</strong></td><td>${analyticsNumber(row.calls)}</td><td>${analyticsNumber(row.succeeded)} / ${analyticsNumber(row.failed)}</td><td>${analyticsNumber(row.output_units)}</td><td>${analyticsNumber(row.charged_points)}</td><td>${analyticsDuration(row.avg_duration_ms)}</td></tr>`).join('') : emptyTableRow(6);
  const users = data.top_users || [];
  $('#analyticsUserBody').innerHTML = users.length ? users.map(row => `<tr><td><strong>${escapeHtml(row.username || '未知用户')}</strong></td><td>${analyticsNumber(row.tasks)}</td><td>${analyticsNumber(row.output_units)}</td><td>${analyticsNumber(row.charged_points)}</td><td>${analyticsNumber(row.failures)}</td></tr>`).join('') : emptyTableRow(5);
  const failureCategories = data.failures?.categories || [];
  $('#analyticsFailureList').innerHTML = failureCategories.length ? failureCategories.map(row => {
    const sample = Array.isArray(row.samples) && row.samples.length ? row.samples[0] : '暂无错误样例';
    return `<article class="analytics-failure-item"><strong>${escapeHtml(row.label || row.category || '未知错误')}</strong><span>${analyticsNumber(row.count)} 次</span><span class="analytics-failure-sample">${escapeHtml(sample)}</span><time>${analyticsTimestamp(row.latest_at)}</time></article>`;
  }).join('') : '<div class="analytics-empty-row">当前范围没有失败记录</div>';
}

function setAnalyticsState(state, message = '') {
  $('#analyticsLoading').hidden = state !== 'loading';
  $('#analyticsError').hidden = state !== 'error';
  $('#analyticsForbidden').hidden = state !== 'forbidden';
  $('#analyticsEmpty').hidden = state !== 'empty';
  $('#analyticsContent').hidden = state !== 'ready';
  if (state === 'error') $('#analyticsErrorMessage').textContent = message || '请稍后重试';
}

async function loadAnalytics() {
  setAnalyticsState('loading');
  $('#refreshAnalytics').disabled = true;
  try {
    const data = await api(`/api/admin/analytics${analyticsQuery()}`, {redirectOnUnauthorized:false});
    renderAnalytics(data);
    setAnalyticsState(Number(data.summary?.total_tasks || 0) > 0 ? 'ready' : 'empty');
  } catch (error) {
    if (error.status === 403 || error.code === 'insufficient_role') setAnalyticsState('forbidden');
    else setAnalyticsState('error', error.message);
  } finally {
    $('#refreshAnalytics').disabled = false;
  }
}

async function activateAdminSection(section, {load = true, updateUrl = true} = {}) {
  currentSection = ['shares', 'analytics'].includes(section) ? section : 'users';
  $('#usersSection').hidden = currentSection !== 'users';
  $('#sharesSection').hidden = currentSection !== 'shares';
  $('#analyticsSection').hidden = currentSection !== 'analytics';
  document.querySelectorAll('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === currentSection));
  if (updateUrl) {
    const target = `${location.pathname}${location.search}${currentSection === 'users' ? '' : `#${currentSection}`}`;
    history.replaceState(null, '', target);
  }
  if (!load) return;
  if (currentSection === 'analytics') await loadAnalytics();
  else if (currentSection === 'shares') await loadShareStatistics();
  else await loadDashboard();
}

async function loadDashboard() {
  const [overview, users, usage] = await Promise.all([
    api(`/api/admin/overview${query()}`),
    api(`/api/admin/users${query(true)}`),
    api(`/api/admin/usage${usageQuery()}`),
  ]);
  currentUsers = users.users || [];
  currentUsage = usage.events || [];
  renderOverview(overview);
  renderUsers();
  renderUsage();
}

async function updateUserStatus(id, status) {
  await api(`/api/admin/users/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status})});
  toast(status === 'enabled' ? '用户已允许使用' : '用户已禁用');
  await loadDashboard();
}

async function updateUserRole(id, role) {
  const currentPassword = prompt('请输入当前密码以确认角色变更');
  if (currentPassword == null) return;
  await api(`/api/admin/users/${id}/role`, {
    redirectOnUnauthorized:false,
    method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role,current_password:currentPassword})
  });
  toast('用户角色已更新');
  await loadDashboard();
}

function openCredit(id) {
  selectedUser = currentUsers.find(user => user.id === Number(id));
  if (!selectedUser) return;
  $('#creditUserLabel').textContent = `${selectedUser.username} · 当前余额 ${selectedUser.credit_balance}，可用 ${selectedUser.available_points}`;
  $('#creditAmount').value = '';
  $('#creditReason').value = '';
  $('#creditDialog').showModal();
}

function enableModelPricingKeyboardScroll(list) {
  if (!list) return;
  list.addEventListener('keydown', event => {
    if (event.target !== list) return;
    const pageStep = Math.max(80, Math.round(list.clientHeight * 0.85));
    const scrollActions = {
      ArrowDown: () => { list.scrollTop += 40; },
      ArrowUp: () => { list.scrollTop -= 40; },
      PageDown: () => { list.scrollTop += pageStep; },
      PageUp: () => { list.scrollTop -= pageStep; },
      Home: () => { list.scrollTop = 0; },
      End: () => { list.scrollTop = list.scrollHeight; },
    };
    const scroll = scrollActions[event.key];
    if (!scroll) return;
    event.preventDefault();
    scroll();
  });
}

async function openPricing() {
  const data = await api('/api/admin/pricing');
  const categoryLabels = {image:'图片模型', video:'视频模型', chat:'对话模型', other:'已配置的其他模型'};
  const groups = new Map();
  (data.models || []).forEach(model => {
    const category = model.category || 'other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(model);
  });
  const list = $('#modelPricingList');
  list.innerHTML = (data.models || []).length ? [...groups.entries()].map(([category,models]) => `
    <section class="model-pricing-group">
      <h3>${escapeHtml(categoryLabels[category] || '其他模型')} · ${models.length}</h3>
      ${models.map(model => {
        const displayName = model.name || model.model;
        const detail = [displayName !== model.model ? model.model : '', ...(model.providers || [])].filter(Boolean).join(' · ');
        return `<label class="model-pricing-row"><span class="model-pricing-copy"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><small title="${escapeHtml(detail)}">${escapeHtml(detail || '已保存模型')}</small></span><input data-model-price="${escapeHtml(model.model)}" type="number" min="0" max="1000000" step="1" value="${Number(model.unit_cost || 0)}" required aria-label="${escapeHtml(displayName)}积分单价"></label>`;
      }).join('')}
    </section>`).join('') : '<div class="model-pricing-empty">API 设置中还没有已保存的模型，请先在 API 设置中拉取并保存模型。</div>';
  Object.entries(data.pricing || {}).forEach(([key,value]) => {
    const input = $(`#pricingForm [data-category-price="${key}"]`);
    if (input) input.value = value;
  });
  $('#pricingDialog').showModal();
}

function openAccount() {
  $('#accountUsername').value = currentAdmin;
  $('#accountCurrentPassword').value = '';
  $('#accountNewPassword').value = '';
  $('#accountMessage').textContent = '';
  $('#accountMessage').classList.remove('error');
  $('#accountDialog').showModal();
}

function downloadExport(type) {
  const link = document.createElement('a');
  const suffix = type === 'usage' ? usageQuery() : (type === 'shares' ? shareQuery() : query(true));
  link.href = `/api/admin/export/${type}.csv${suffix}`;
  link.click();
}

async function initDashboard() {
  const status = await api('/api/admin/auth/status');
  if (!status.authenticated) { location.replace('/admin/login'); return; }
  currentAdmin = status.username;
  currentRole = status.role || 'admin';
  currentPermissions = Array.isArray(status.permissions) ? status.permissions : [];
  $('#adminName').textContent = currentAdmin;
  document.querySelectorAll('[data-open-pricing]').forEach(node => {
    node.hidden = !currentPermissions.includes('manage_pricing');
  });
  enableModelPricingKeyboardScroll($('#modelPricingList'));
  setPreset('7');
  setAnalyticsPreset('7');
  const latestShareMonth = shareMonthValue();
  $('#shareMonth').max = latestShareMonth;
  setShareMonth(latestShareMonth);
  const initialSection = location.hash === '#shares' ? 'shares' : (location.hash === '#analytics' ? 'analytics' : 'users');
  await activateAdminSection(initialSection, {updateUrl:false});

  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', async () => {
    try { await activateAdminSection(button.dataset.section); }
    catch(error) { toast(error.message, true); }
  }));
  window.addEventListener('hashchange', () => {
    const section = location.hash === '#shares' ? 'shares' : (location.hash === '#analytics' ? 'analytics' : 'users');
    if (section !== currentSection) activateAdminSection(section, {updateUrl:false}).catch(error => toast(error.message, true));
  });

  document.querySelectorAll('[data-analytics-range]').forEach(button => button.addEventListener('click', async () => {
    setAnalyticsPreset(button.dataset.analyticsRange);
    await loadAnalytics();
  }));
  $('#applyAnalyticsDate').addEventListener('click', async () => {
    const from = $('#analyticsFromDate').value;
    const to = $('#analyticsToDate').value;
    if (!from || !to) { toast('请选择完整的开始和结束日期', true); return; }
    const fromMs = shanghaiMidnightMs(from);
    const toMs = shanghaiMidnightMs(shiftShanghaiDate(to, 1));
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      toast('结束日期必须晚于或等于开始日期', true);
      return;
    }
    currentAnalyticsRange = {from:fromMs, to:toMs};
    document.querySelectorAll('[data-analytics-range]').forEach(button => button.classList.remove('active'));
    await loadAnalytics();
  });
  $('#refreshAnalytics').addEventListener('click', loadAnalytics);
  $('#retryAnalytics').addEventListener('click', loadAnalytics);
  document.querySelectorAll('[data-analytics-metric]').forEach(button => button.addEventListener('click', () => {
    currentAnalyticsMetric = button.dataset.analyticsMetric;
    document.querySelectorAll('[data-analytics-metric]').forEach(item => item.classList.toggle('active', item === button));
    renderAnalyticsTrend(currentAnalyticsData?.series || []);
  }));

  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', async () => { setPreset(button.dataset.range); await loadDashboard(); }));
  $('#applyDate').addEventListener('click', async () => {
    const from = $('#fromDate').value;
    const to = $('#toDate').value;
    currentRange.from = from ? new Date(`${from}T00:00:00`).getTime() : null;
    currentRange.to = to ? new Date(`${to}T00:00:00`).getTime() + 86400000 : null;
    document.querySelectorAll('[data-range]').forEach(button => button.classList.remove('active'));
    await loadDashboard();
  });
  let searchTimer;
  $('#userSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer=setTimeout(loadDashboard,250); });
  $('#statusFilter').addEventListener('change', loadDashboard);
  $('#roleFilter').addEventListener('change', loadDashboard);
  $('#refreshUsers').addEventListener('click', loadDashboard);
  let usageSearchTimer;
  $('#usageSearch').addEventListener('input', () => { clearTimeout(usageSearchTimer); usageSearchTimer=setTimeout(loadDashboard,250); });
  $('#usageCategoryFilter').addEventListener('change', loadDashboard);
  $('#usageStatusFilter').addEventListener('change', loadDashboard);
  $('#refreshUsage').addEventListener('click', loadDashboard);
  $('#shareMonth').addEventListener('change', async event => {
    setShareMonth(event.currentTarget.value);
    try { await loadShareStatistics(); } catch(error) { toast(error.message, true); }
  });
  $('#previousShareMonth').addEventListener('click', async () => {
    shiftShareMonth(-1);
    try { await loadShareStatistics(); } catch(error) { toast(error.message, true); }
  });
  $('#nextShareMonth').addEventListener('click', async () => {
    shiftShareMonth(1);
    try { await loadShareStatistics(); } catch(error) { toast(error.message, true); }
  });
  let shareSearchTimer;
  $('#shareSearch').addEventListener('input', () => {
    clearTimeout(shareSearchTimer);
    shareSearchTimer = setTimeout(() => loadShareStatistics().catch(error => toast(error.message, true)), 250);
  });
  $('#refreshShares').addEventListener('click', () => loadShareStatistics().catch(error => toast(error.message, true)));
  $('#usersBody').addEventListener('click', async event => {
    const statusButton = event.target.closest('[data-user-status]');
    const creditButton = event.target.closest('[data-user-credit]');
    if (statusButton) {
      const [id,status] = statusButton.dataset.userStatus.split(':');
      try { await updateUserStatus(id,status); } catch(error) { toast(error.message,true); }
    }
    if (creditButton) openCredit(creditButton.dataset.userCredit);
  });
  $('#usersBody').addEventListener('change', async event => {
    const roleSelect = event.target.closest('[data-user-role]');
    if (!roleSelect) return;
    try {
      await updateUserRole(roleSelect.dataset.userRole, roleSelect.value);
    } catch(error) {
      toast(error.message, true);
      await loadDashboard();
    }
  });
  $('#creditForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`/api/admin/users/${selectedUser.id}/credits`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:$('#creditMode').value,amount:Number($('#creditAmount').value),reason:$('#creditReason').value.trim()})});
      $('#creditDialog').close(); toast('积分调整已记录'); await loadDashboard();
    } catch(error) { toast(error.message,true); }
  });
  const pricingButton = $('[data-open-pricing]');
  if (pricingButton && currentPermissions.includes('manage_pricing')) {
    pricingButton.addEventListener('click', () => openPricing().catch(error => toast(error.message,true)));
  }
  $('#pricingForm').addEventListener('submit', async event => {
    event.preventDefault();
    const pricing = {};
    event.currentTarget.querySelectorAll('[data-category-price]').forEach(input => {
      pricing[input.dataset.categoryPrice] = Number(input.value);
    });
    const modelPricing = {};
    event.currentTarget.querySelectorAll('[data-model-price]').forEach(input => {
      modelPricing[input.dataset.modelPrice] = Number(input.value);
    });
    const payload = {pricing, model_pricing:modelPricing};
    const currentPassword = prompt('请输入当前密码以确认修改价格策略');
    if (currentPassword == null) return;
    try { await api('/api/admin/pricing',{method:'PUT',headers:{'Content-Type':'application/json','X-Current-Password':currentPassword},body:JSON.stringify(payload)}); $('#pricingDialog').close(); toast('模型单价已保存'); await loadDashboard(); } catch(error) { toast(error.message,true); }
  });
  $('[data-open-account]').addEventListener('click', openAccount);
  $('#accountForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    const message = $('#accountMessage');
    submitButton.disabled = true;
    message.classList.remove('error');
    message.textContent = '正在保存…';
    try {
      const data = await api('/api/admin/auth/account',{redirectOnUnauthorized:false,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#accountUsername').value.trim(),current_password:$('#accountCurrentPassword').value,password:$('#accountNewPassword').value})});
      currentAdmin=data.username; $('#adminName').textContent=currentAdmin; $('#accountDialog').close(); toast('管理员账号已更新');
    } catch(error) {
      message.textContent = error.message;
      message.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
  });
  $('#adminLogout').addEventListener('click', async () => { await fetch('/api/admin/auth/logout',{method:'POST'}); location.replace('/admin/login'); });
  $('#exportUsers').addEventListener('click', () => downloadExport('users'));
  $('#exportUsage').addEventListener('click', () => downloadExport('usage'));
  $('#exportShares').addEventListener('click', () => downloadExport('shares'));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    document.getElementById(button.dataset.closeDialog)?.close();
  }));
}

(async () => {
  try {
    if (page === 'login') await initLogin();
    if (page === 'dashboard') await initDashboard();
  } catch (error) {
    if (page === 'login') showMessage(error.message);
    else toast(error.message, true);
  }
})();
