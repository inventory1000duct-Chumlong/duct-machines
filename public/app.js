(() => {
  "use strict";

  const APP_VERSION = "10.2.1";
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => Number.isFinite(+n) ? (+n).toLocaleString(undefined, { maximumFractionDigits: d }) : "-";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let scanRows = [];
  let marketState = {};
  let sectorRows = [];
  let selectedOpportunity = null;
  let versionInfo = {};

  function showError(message) {
    const el = $("errorBanner");
    if (!el) return;
    el.style.display = "block";
    el.textContent = "⚠️ " + message;
  }

  function clearError() {
    const el = $("errorBanner");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function setStatus(mode, text) {
    $("dot").className = "dot " + (mode === "ok" ? "ok" : mode === "err" ? "err" : "");
    $("status").textContent = text;
  }

  async function api(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(path, { cache: "no-store", signal: controller.signal });
      const txt = await res.text();
      if (!res.ok) throw new Error(res.status + " " + txt.slice(0, 260));
      return JSON.parse(txt);
    } finally {
      clearTimeout(timeout);
    }
  }

  function gradeBadge(g) {
    const c = g === "A+" ? "AP" : g;
    return '<span class="grade ' + c + '">' + esc(g) + '</span>';
  }

  function kpi(label, value) {
    return '<div class="kpi"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function qcard(label, value) {
    return '<div class="quant-card"><span>' + esc(label) + '</span><h2>' + esc(value) + '</h2></div>';
  }

  function activateTabs() {
    document.querySelectorAll(".tab").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
        document.querySelectorAll(".pane").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "health") renderHealth();
        if (btn.dataset.tab === "sector") renderSectors();
        if (btn.dataset.tab === "quant") renderQuant();
      };
    });
  }

  async function loadVersion() {
    versionInfo = await api("/api/version");
    $("versionBadge").textContent = "V" + versionInfo.version + " " + versionInfo.edition;
    $("backendVer").textContent = "V" + versionInfo.version;
  }

  async function scan() {
    clearError();
    setStatus("", "กำลังสแกน...");
    $("pick").className = "pick empty";
    $("pick").textContent = "กำลังโหลด...";
    try {
      const data = await api("/api/scan?limit=" + $("limit").value);
      scanRows = data.rows || [];
      marketState = data.market || {};
      sectorRows = data.sectors || [];
      selectedOpportunity = data.topOpportunity || scanRows[0] || null;

      $("regime").textContent = marketState.regime || "-";
      $("risk").textContent = marketState.risk || "-";
      $("fng").textContent = marketState.fng ?? "-";

      renderRows();
      renderPick();
      renderSectors();
      renderQuant();
      setStatus("ok", "สแกนสำเร็จ • " + scanRows.length + " เหรียญ");
    } catch (err) {
      console.error(err);
      setStatus("err", "โหลดไม่สำเร็จ");
      showError(err.message || String(err));
      $("pick").className = "pick empty";
      $("pick").textContent = "โหลดไม่สำเร็จ: " + (err.message || String(err));
    }
  }

  function renderRows() {
    const q = $("q").value.trim().toUpperCase();
    const rows = scanRows.filter(x => !q || x.symbol.includes(q) || x.name.toUpperCase().includes(q));
    $("rows").innerHTML = rows.map((x, i) =>
      '<tr><td>' + (i + 1) + '</td>' +
      '<td><b>' + esc(x.symbol) + '</b><br><small>' + esc(x.name) + '</small></td>' +
      '<td>' + esc(x.sector) + '</td>' +
      '<td><b>' + esc(x.score) + '</b></td>' +
      '<td>' + esc(x.confidence) + '%</td>' +
      '<td>' + gradeBadge(x.grade) + '</td>' +
      '<td>' + esc(x.quant?.quantGrade || "-") + ' / ' + esc(x.quant?.signalQuality ?? "-") + '</td>' +
      '<td>' + fmt(x.quant?.expectedValue, 2) + '</td>' +
      '<td>' + esc(x.quant?.winProb ?? "-") + '%</td>' +
      '<td>' + esc(x.decision) + '</td></tr>'
    ).join("") || '<tr><td colspan="10" class="empty">ไม่พบข้อมูล</td></tr>';
  }

  function renderPick() {
    const p = selectedOpportunity;
    if (!p) {
      $("pick").className = "pick empty";
      $("pick").textContent = "ยังไม่มีข้อมูล";
      return;
    }
    $("pick").className = "pick";
    $("pick").innerHTML =
      '<div class="head"><div><div class="sym">' + esc(p.symbol) + '</div>' +
      '<div class="sub">' + esc(p.name) + ' • ' + esc(p.sector) + ' • $' + fmt(p.price, 6) + '</div></div>' +
      gradeBadge(p.grade) + '</div>' +
      '<div class="reason"><b>Decision:</b> ' + esc(p.decision) +
      ' | <b>EV:</b> ' + fmt(p.quant?.expectedValue, 2) +
      ' | <b>Win Prob:</b> ' + esc(p.quant?.winProb ?? "-") + '%' +
      ' | <b>Signal Quality:</b> ' + esc(p.quant?.signalQuality ?? "-") +
      '<br><b>Max Risk:</b> ' + esc(p.quant?.maxRiskPct ?? "-") + '%' +
      ' | <b>Quant Grade:</b> ' + esc(p.quant?.quantGrade || "-") +
      ' | <b>Hotfix:</b> V' + APP_VERSION + '</div>' +
      '<div class="kpis">' +
      kpi("Score", p.score) +
      kpi("Confidence", p.confidence + "%") +
      kpi("EV", fmt(p.quant?.expectedValue, 2)) +
      kpi("Win", (p.quant?.winProb ?? "-") + "%") +
      kpi("Max Risk", (p.quant?.maxRiskPct ?? "-") + "%") +
      kpi("Grade", p.grade) +
      '</div>' +
      '<div class="zone">Entry: $' + fmt(p.entryLow, 6) + ' - $' + fmt(p.entryHigh, 6) +
      ' | SL $' + fmt(p.sl, 6) +
      ' | TP1 $' + fmt(p.tp1, 6) +
      ' | Position $' + fmt(p.position?.positionValue, 0) + '</div>';
  }

  function renderQuant() {
    const p = selectedOpportunity;
    if (!p) {
      $("quantBox").className = "pick empty";
      $("quantBox").textContent = "ยังไม่มีข้อมูล";
      return;
    }
    $("quantBox").className = "pick";
    $("quantBox").innerHTML =
      '<h3>' + esc(p.symbol) + ' Quant Metrics</h3>' +
      '<div class="grid">' +
      qcard("Expected Value", fmt(p.quant?.expectedValue, 2)) +
      qcard("Win Probability", (p.quant?.winProb ?? "-") + "%") +
      qcard("Signal Quality", p.quant?.signalQuality ?? "-") +
      qcard("Quant Grade", p.quant?.quantGrade || "-") +
      qcard("Max Risk", (p.quant?.maxRiskPct ?? "-") + "%") +
      qcard("Position Value", "$" + fmt(p.position?.positionValue, 0)) +
      '</div>';
  }

  function renderSectors() {
    $("sectorGrid").innerHTML = sectorRows.map(s =>
      '<div class="sector-card"><h3>' + esc(s.sector) + ' • ' + esc(s.strength) + '</h3>' +
      '<p>Coins: ' + esc(s.count) + ' | 24h ' + fmt(s.avg24, 2) + '% | 7d ' + fmt(s.avg7, 2) + '%</p>' +
      '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, s.strength)) + '%"></i></div></div>'
    ).join("") || '<div class="sector-card">ยังไม่มีข้อมูล</div>';
  }

  async function renderHealth() {
    try {
      const [health, version] = await Promise.all([api("/api/health"), api("/api/version")]);
      $("raw").textContent = JSON.stringify({ version, health }, null, 2);
      $("healthGrid").innerHTML =
        (health.services || []).map(s =>
          '<div class="health-card ' + (s.ok ? "ok" : "err") + '"><h3>' + (s.ok ? "✅" : "❌") + ' ' + esc(s.name) + '</h3>' +
          '<p>' + esc(s.status) + ' • ' + esc(s.latencyMs) + 'ms</p></div>'
        ).join("") +
        '<div class="health-card ok"><h3>✅ Backend Version</h3><p>V' + esc(version.version) + ' ' + esc(version.edition) + '<br>Build ' + esc(version.build) + '</p></div>';
    } catch (err) {
      showError("Health error: " + (err.message || String(err)));
    }
  }

  window.addEventListener("error", (event) => {
    showError(event.message || "JavaScript error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    showError(event.reason?.message || String(event.reason || "Unhandled promise rejection"));
  });

  function init() {
    activateTabs();
    $("refresh").onclick = scan;
    $("scanBtn").onclick = scan;
    $("q").oninput = renderRows;
    loadVersion().then(scan).catch(err => {
      showError("Version load error: " + (err.message || String(err)));
      setStatus("err", "โหลดเวอร์ชันไม่สำเร็จ");
    });
    renderHealth();
  }

  init();
})();
