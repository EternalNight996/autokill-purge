var S = { status: null, catalog: null };
var LABEL = { approved: "已入库", pending: "待审核", rejected: "已驳回", missing: "缺失" };

function $(id) { return document.getElementById(id); }
async function api(path, options) { return (await fetch(path, options)).json(); }

function paintStatus(s) {
  S.status = s;
  var h = s.health && s.health.ok ? s.health.data : null;
  var up = !!h;
  var guard = s.guard || { canWrite: false, reason: "" };
  var lede = up
    ? "记忆库在线 · v" + h.version + " · schema " + h.schema_version + (h.writable ? "" : " · 只读")
    : "记忆库未连接 · " + ((s.discovery && s.discovery.source) === "unreachable" ? "服务没起来" : "地址不可达");
  if (up && !guard.canWrite && guard.reason) lede += " · 写入已禁用";
  $("lede").textContent = lede;
  $("openLib").disabled = !up;
  $("openSettings").open = false;
  $("base").value = s.base || "";
  $("port").value = s.port || "";
  $("discovery").checked = !s.discovery || s.discovery.source !== "config.base";
  $("cloudBase").value = (s.cloud && s.cloud.base) || "";
  $("cloudOn").checked = !!(s.cloud && s.cloud.enabled);
  $("meta").textContent = "地址来源 " + ((s.discovery && s.discovery.source) || "?") + " · 配置 " + s.configPath + " · 写入日志 " + (s.writesLog || "-");
  if (!up) $("settings").open = true;
}

function paintCatalog(c) {
  S.catalog = c;
  var items = c.items || [];
  var guard = (S.status && S.status.guard) || { canWrite: false, reason: "" };
  var done = items.filter(function (i) { return i.state === "approved"; }).length;
  var todo = items.filter(function (i) { return i.state === "missing" || i.state === "rejected"; }).length;

  $("bar").style.width = items.length ? (done / items.length * 100).toFixed(1) + "%" : "0%";
  var hint = "";
  if (!items.length) hint = "还没有装备清单";
  else if (!todo) hint = "全部就绪，不用再动";
  else if (!guard.canWrite) hint = guard.reason || "写入已禁用";
  else hint = "点「补齐 " + todo + " 项」把它们登记进记忆库，之后等人审核。";
  $("summary").innerHTML = "<b>" + items.length + "</b> 项装备 · 已入库 <b>" + done + "</b>"
    + (todo ? " · 待处理 <b>" + todo + "</b>" : "") + " — " + hint;

  var list = $("list");
  list.innerHTML = "";
  items.forEach(function (item) {
    var li = document.createElement("li");
    li.className = "row" + (item.state === "approved" ? "" : " need");
    var dot = document.createElement("i");
    dot.className = "dot " + item.state;
    var name = document.createElement("div");
    name.className = "name";
    var b = document.createElement("b");
    b.textContent = item.title;
    var sub = document.createElement("span");
    sub.textContent = item.kind + (item.path ? " · " + item.path : "");
    name.appendChild(b);
    name.appendChild(sub);
    var st = document.createElement("div");
    st.className = "state " + item.state;
    st.textContent = item.state === "rejected" && item.stale ? "已驳回 · 接口未同步" : (LABEL[item.state] || "未知");
    var btn = document.createElement("button");
    btn.className = "quiet sm";
    btn.textContent = item.state === "approved" ? "更新" : item.state === "pending" ? "已提交" : "登记";
    btn.disabled = item.state === "pending" || !guard.canWrite;
    btn.onclick = function () { submit(item, btn); };
    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(st);
    li.appendChild(btn);
    list.appendChild(li);
  });

  var fill = $("fill");
  var todoItems = items.filter(function (i) { return i.state === "missing" || i.state === "rejected"; });
  fill.textContent = todoItems.length ? "补齐 " + todoItems.length + " 项" : "全部已登记";
  fill.disabled = !todoItems.length || !guard.canWrite;
  fill.onclick = function () { fillAll(todoItems, fill); };
}

async function submit(item, btn) {
  btn.disabled = true;
  btn.textContent = "提交中";
  var r = await api("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
  btn.textContent = r.ok ? "已提交" : "失败";
  setTimeout(refresh, 500);
}

async function fillAll(items, btn) {
  btn.disabled = true;
  for (var i = 0; i < items.length; i++) {
    btn.textContent = "补齐 " + (i + 1) + "/" + items.length;
    await api("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: items[i].id }) });
  }
  refresh();
}

async function refresh() {
  var s = await api("/api/status");
  paintStatus(s);
  var c = await api("/api/catalog");
  paintCatalog(c);
}

$("refresh").onclick = refresh;
$("openLib").onclick = async function () {
  var r = await api("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open" }) });
  if (r.open) window.open(r.open, "_blank");
};
$("save").onclick = async function () {
  await api("/api/config", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base: $("base").value.trim(),
      port: Number($("port").value) || undefined,
      discovery: $("discovery").checked,
      cloud: { enabled: $("cloudOn").checked, base: $("cloudBase").value.trim() }
    })
  });
  refresh();
};
$("watchdog").onclick = async function () {
  var r = await api("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "watchdog" }) });
  $("meta").textContent = r.ok ? "服务已拉起，稍等自检…" : "启动失败：" + (r.detail || "");
  setTimeout(refresh, 1500);
};

refresh();

// probe: ?probe=1 writes the viewport size into the title, so headless shots can be checked
if (location.search.indexOf('probe=1') >= 0) { document.title = 'viewport ' + window.innerWidth + 'x' + window.innerHeight; }
