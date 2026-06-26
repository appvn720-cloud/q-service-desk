const cfg = window.APP_CONFIG || {};
let appConfig = cfg;
let isConfigured = Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_ANON_KEY);
let sb = null;

const state = {
  session: null,
  profile: null,
  agents: [],
  tickets: [],
  profiles: [],
  selectedTickets: new Set()
};

const $ = (id) => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const timeText = (iso) => iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
const dateText = (iso) => iso ? new Date(iso).toLocaleDateString("th-TH") : "";
const minutesOf = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const parseDigitalTime = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const seconds = raw.split(":")[2] || "00";
    return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:${seconds.padStart(2, "0")}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length === 3) {
    return `0${digits[0]}:${digits.slice(1)}:00`;
  }
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}:00`;
  }
  if (digits.length === 5) {
    return `0${digits[0]}:${digits.slice(1, 3)}:${digits.slice(3, 5)}`;
  }
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
  }
  return raw;
};
const displayTime = (value) => parseDigitalTime(value) || "-";
const formatTimeInput = (value) => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
};
const normalizeAgentTimes = (agent) => ({
  ...agent,
  work_start: parseDigitalTime(agent.work_start),
  break_start: parseDigitalTime(agent.break_start),
  break_end: parseDigitalTime(agent.break_end),
  work_end: parseDigitalTime(agent.work_end)
});
const isValidDigitalTime = (value) => {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute, second] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
};
const currentMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

function toast(message, isError = false) {
  const el = $("liveStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--danger)" : "var(--ok)";
}

function requireConfigured() {
  $("setupNotice").classList.toggle("hidden", isConfigured);
  if (!isConfigured) {
    $("appShell").classList.add("auth-only");
    $("mainSidebar").classList.add("hidden");
    $("appView").classList.add("hidden");
    $("authView").classList.remove("hidden");
    return false;
  }
  return true;
}

async function loadRuntimeConfig() {
  if (isConfigured) return;
  try {
    const response = await fetch("/.netlify/functions/config");
    if (!response.ok) return;
    const remoteConfig = await response.json();
    appConfig = { ...appConfig, ...remoteConfig };
    isConfigured = Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_ANON_KEY);
  } catch {
    isConfigured = false;
  }
}

function agentStatus(agent) {
  const now = currentMinutes();
  const start = minutesOf(agent.work_start);
  const end = minutesOf(agent.work_end);
  const bs = minutesOf(agent.break_start);
  const be = minutesOf(agent.break_end);
  if (start === null || end === null) return { label: "ข้อมูลเวลาไม่ครบ", available: false, rankPenalty: 0 };
  if (now < start) return { label: "ยังไม่เข้างาน", available: false, rankPenalty: 0 };
  if (now >= end) return { label: "เลิกงานแล้ว", available: false, rankPenalty: 0, ended: true };
  if (end - now <= 15) return { label: "ใกล้เลิกงาน", available: false, rankPenalty: 0 };
  if (bs !== null && be !== null && now >= bs && now < be) return { label: "พัก", available: false, rankPenalty: 0 };
  if (be !== null && now >= be && now - be <= 15) return { label: "กลับจากพัก", available: true, rankPenalty: 100000 };
  return { label: "พร้อมรับงาน", available: true, rankPenalty: 0 };
}

function sortedQueue(business) {
  return state.agents
    .filter((a) => a.active && a.business === business)
    .map((a) => ({ ...a, status: agentStatus(a) }))
    .filter((a) => a.status.available)
    .sort((a, b) => {
      const loadA = Number(a.open_count || 0) + a.status.rankPenalty;
      const loadB = Number(b.open_count || 0) + b.status.rankPenalty;
      if (loadA !== loadB) return loadA - loadB;
      return new Date(a.last_assigned_at || "1970-01-01") - new Date(b.last_assigned_at || "1970-01-01");
    });
}

async function loadAll() {
  const [{ data: agents, error: e1 }, { data: tickets, error: e2 }, { data: profiles, error: e3 }] = await Promise.all([
    sb.from("agents").select("*").order("name"),
    sb.from("tickets").select("*").order("created_at", { ascending: false }).limit(1000),
    sb.from("profiles").select("*").order("name")
  ]);
  if (e1 || e2 || e3) {
    toast((e1 || e2 || e3).message, true);
    return;
  }
  state.agents = (agents || []).map(normalizeAgentTimes);
  state.tickets = tickets || [];
  state.profiles = profiles || [];
  renderAll();
}

async function loadProfile() {
  const uid = state.session?.user?.id;
  if (!uid) return;
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error) {
    toast(error.message, true);
    return;
  }
  state.profile = data || { id: uid, name: state.session.user.email, role: "t1" };
  $("currentUserText").textContent = `${state.profile.name || state.session.user.email} · ${state.profile.role}`;
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", state.profile.role !== "admin"));
}

function renderAll() {
  renderAssignees();
  renderQueue();
  renderAgents();
  renderTickets();
  renderDashboard();
  renderProfiles();
}

function setBusinessPicker(group, value) {
  const input = $(`${group}Business`);
  if (input) input.value = value;
  document.querySelectorAll(`[data-${group}-business]`).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset[`${group}Business`] === value);
  });
}

function renderAssignees() {
  document.querySelectorAll("[data-ticket-form]").forEach((form) => {
    const select = form.querySelector(".ticket-assignee");
    const agents = sortedQueue(form.dataset.business);
    select.innerHTML = agents.length
      ? agents.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")
      : `<option value="">ไม่มี T2 ที่พร้อมรับงาน</option>`;
  });
}

function renderQueue() {
  ["KFC", "NonKFC"].forEach((business) => {
    const queue = sortedQueue(business);
    const next = document.querySelector(`[data-next-t2="${business}"]`);
    const list = document.querySelector(`[data-queue-list="${business}"]`);
    if (next) next.textContent = queue[0]?.name || "ไม่มี T2 ที่พร้อมรับงาน";
    if (list) {
      list.innerHTML = queue.map((a, index) => `
        <div class="queue-item">
          <span>${index + 1}. ${escapeHtml(a.name)}</span>
          <span>${a.open_count || 0} งานเปิด</span>
        </div>
      `).join("") || `<div class="queue-item"><span>ไม่มีคิวว่าง</span><span>-</span></div>`;
    }
  });
}

function renderAgents() {
  const rows = state.agents.filter((a) => a.active);
  $("agentsTable").innerHTML = rows.map((a) => {
    const s = agentStatus(a);
    return `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${a.business}</td>
        <td>${displayTime(a.work_start)} - ${displayTime(a.work_end)}</td>
        <td>${displayTime(a.break_start)} - ${displayTime(a.break_end)}</td>
        <td>${a.active ? s.label : "ปิดใช้งาน"}</td>
        <td>
          <div class="row-actions">
            <button class="ghost-btn" data-edit-agent="${a.id}">แก้ไข</button>
            <button class="danger-btn" data-delete-agent="${a.id}">ลบ</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || `
    <tr>
      <td colspan="6">ยังไม่มีข้อมูล T2</td>
    </tr>
  `;
}

function ticketMatches(t) {
  const text = $("filterText").value.trim().toLowerCase();
  const business = $("filterBusiness").value;
  const status = $("filterStatus").value;
  if (business && t.business !== business) return false;
  if (status && t.status !== status) return false;
  if (!text) return true;
  return [t.ticket_number, t.assignee_name, t.created_by_name].some((v) => String(v || "").toLowerCase().includes(text));
}

function renderTickets() {
  const rows = state.tickets.filter(ticketMatches);
  $("ticketsTable").innerHTML = rows.map((t) => `
    <tr>
      <td><input type="checkbox" data-ticket-check="${t.id}" ${state.selectedTickets.has(t.id) ? "checked" : ""}></td>
      <td>${escapeHtml(t.ticket_number)}</td>
      <td>${t.business}</td>
      <td>${escapeHtml(t.assignee_name || "")}</td>
      <td>${escapeHtml(t.created_by_name || "")}</td>
      <td>${dateText(t.created_at)}</td>
      <td>${timeText(t.created_at)}</td>
      <td>${timeText(t.closed_at) || "-"}</td>
      <td>${t.reopen_count || 0}</td>
      <td>
        <select data-ticket-status="${t.id}">
          <option value="open" ${t.status === "open" ? "selected" : ""}>เปิดอยู่</option>
          <option value="closed" ${t.status === "closed" ? "selected" : ""}>ปิดแล้ว</option>
          <option value="reopened" ${t.status === "reopened" ? "selected" : ""}>เปิดใหม่</option>
        </select>
      </td>
      <td><button class="danger-btn" data-delete-ticket="${t.id}">ลบ</button></td>
    </tr>
  `).join("");
  $("selectAllTickets").checked = rows.length > 0 && rows.every((t) => state.selectedTickets.has(t.id));
}

function renderDashboard() {
  const total = state.tickets.length;
  const open = state.tickets.filter((t) => t.status !== "closed").length;
  const activeAgents = state.agents.filter((a) => a.active && !agentStatus(a).ended).length;
  $("dashboardCards").innerHTML = [
    ["Ticket ทั้งหมด", total],
    ["งานเปิดอยู่", open],
    ["T2 ที่ยังทำงาน", activeAgents]
  ].map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  const counts = {};
  state.tickets.forEach((t) => {
    const name = t.assignee_name || "ไม่ระบุ";
    counts[name] = (counts[name] || 0) + 1;
  });
  const ranks = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  $("rankingList").innerHTML = ranks.map(([name, count], i) => `
    <div class="rank-item"><span>${i + 1}. ${escapeHtml(name)}</span><strong>${count}</strong></div>
  `).join("") || `<div class="rank-item"><span>ยังไม่มีข้อมูล</span><strong>0</strong></div>`;
}

function renderProfiles() {
  $("profilesTable").innerHTML = state.profiles.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.role}</td>
      <td>${p.id}</td>
      <td><button class="danger-btn" data-delete-profile="${p.id}">ลบ</button></td>
    </tr>
  `).join("");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function createTicket(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const business = form.dataset.business;
  const ticketInput = form.querySelector(".ticket-number");
  const assigneeSelect = form.querySelector(".ticket-assignee");
  const agent = state.agents.find((a) => a.id === assigneeSelect.value);
  if (!agent) return toast("ไม่มี T2 ที่พร้อมรับงาน", true);
  const ticket = {
    ticket_number: ticketInput.value.trim(),
    business,
    assignee_id: agent.id,
    assignee_name: agent.name,
    created_by: state.profile.id,
    created_by_name: state.profile.name || state.session.user.email,
    status: "open",
    created_at: nowIso()
  };
  if (!ticket.ticket_number) return toast("กรุณาใส่เลข Ticket", true);
  const { error } = await sb.rpc("create_ticket_with_agent_load", {
    p_ticket_number: ticket.ticket_number,
    p_business: ticket.business,
    p_assignee_id: ticket.assignee_id,
    p_assignee_name: ticket.assignee_name,
    p_created_by: ticket.created_by,
    p_created_by_name: ticket.created_by_name
  });
  if (error) return toast(error.message, true);
  ticketInput.value = "";
  toast("บันทึก Ticket แล้ว");
  await loadAll();
}

async function saveAgent(event) {
  event.preventDefault();
  const name = $("agentName").value.trim();
  if (!name) return toast("กรุณาใส่ชื่อ T2", true);
  const workStart = parseDigitalTime($("agentStart").value);
  const breakStart = parseDigitalTime($("agentBreakStart").value);
  const breakEnd = parseDigitalTime($("agentBreakEnd").value);
  const workEnd = parseDigitalTime($("agentEnd").value);
  $("agentStart").value = workStart;
  $("agentBreakStart").value = breakStart;
  $("agentBreakEnd").value = breakEnd;
  $("agentEnd").value = workEnd;
  if (!isValidDigitalTime(workStart) || !isValidDigitalTime(workEnd)) {
    return toast("กรุณาใส่เวลาเข้างานและเลิกงานเป็น HH:MM:SS เช่น 08:00:00", true);
  }
  if ((breakStart && !isValidDigitalTime(breakStart)) || (breakEnd && !isValidDigitalTime(breakEnd))) {
    return toast("กรุณาใส่เวลาพักเป็น HH:MM:SS เช่น 12:00:00", true);
  }
  const payload = {
    name,
    business: $("agentBusiness").value,
    work_start: workStart,
    break_start: breakStart || null,
    break_end: breakEnd || null,
    work_end: workEnd,
    active: true,
    updated_at: nowIso()
  };
  const id = $("agentId").value;
  const result = id
    ? await sb.from("agents").update(payload).eq("id", id)
    : await sb.from("agents").insert(payload);
  if (result.error) return toast(result.error.message, true);
  clearAgentForm();
  toast("บันทึก T2 แล้ว");
  await loadAll();
}

function clearAgentForm() {
  ["agentId", "agentName", "agentStart", "agentBreakStart", "agentBreakEnd", "agentEnd"].forEach((id) => $(id).value = "");
  setBusinessPicker("agent", "KFC");
}

async function updateTicketStatus(id, status) {
  const { error } = await sb.rpc("update_ticket_status_with_agent_load", {
    p_ticket_id: id,
    p_status: status
  });
  if (error) return toast(error.message, true);
  toast("อัปเดตสถานะแล้ว");
  await loadAll();
}

async function removeAgent(id) {
  const { error } = await sb.from("agents").update({ active: false, updated_at: nowIso() }).eq("id", id);
  if (error) return toast(error.message, true);
  toast("ลบ T2 แล้ว");
  await loadAll();
}

async function deleteTickets(ids) {
  if (!ids.length) return toast("ยังไม่ได้เลือกรายการ", true);
  const { error } = await sb.from("tickets").delete().in("id", ids);
  if (error) return toast(error.message, true);
  ids.forEach((id) => state.selectedTickets.delete(id));
  toast("ลบรายการแล้ว");
  await loadAll();
}

async function clearHistory() {
  const ids = state.tickets.filter(ticketMatches).map((t) => t.id);
  await deleteTickets(ids);
}

function exportExcel() {
  const filtered = state.tickets.filter(ticketMatches);
  const maxReopen = Math.max(0, ...filtered.map((t) => (t.reopen_times || []).length));
  const rows = filtered.map((t) => {
    const row = {
      "Name(T2 เท่านั้น)": t.assignee_name || "",
      "รับงานจากใคร": t.created_by_name || "",
      "วันที่เท่าไหร่": dateText(t.created_at),
      "เวลาเท่าไหร่": timeText(t.created_at),
      "เลขที่งานอะไร": t.ticket_number,
      "งานปิดกี่โมง": timeText(t.closed_at),
      "สถานะ": t.status,
      "ธุรกิจ": t.business
    };
    for (let i = 0; i < maxReopen; i += 1) {
      row[`เปิดใหม่ ${i + 1}`] = timeText((t.reopen_times || [])[i]) || "";
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "T2 Tickets");
  XLSX.writeFile(wb, `t2-ticket-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function confirmAction(title, text, onOk) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmModal").classList.remove("hidden");
  $("confirmOk").onclick = async () => {
    $("confirmModal").classList.add("hidden");
    await onOk();
  };
}

function bindEvents() {
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("loginEmail").value,
      password: $("loginPassword").value
    });
    if (error) return toast(error.message, true);
    state.session = data.session;
    await startApp();
  });
  $("logoutBtn").addEventListener("click", async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  });
  $("themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
  });
  document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
  document.querySelectorAll("[data-ticket-form]").forEach((form) => form.addEventListener("submit", createTicket));
  document.querySelectorAll("[data-agent-business]").forEach((btn) => btn.addEventListener("click", () => {
    setBusinessPicker("agent", btn.dataset.agentBusiness);
  }));
  $("agentForm").addEventListener("submit", saveAgent);
  $("agentClearBtn").addEventListener("click", clearAgentForm);
  document.querySelectorAll(".digital-time").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatTimeInput(input.value);
    });
    input.addEventListener("blur", () => {
      input.value = parseDigitalTime(input.value);
    });
  });
  ["filterText", "filterBusiness", "filterStatus"].forEach((id) => $(id).addEventListener("input", renderTickets));
  $("exportBtn").addEventListener("click", exportExcel);
  $("deleteSelectedBtn").addEventListener("click", () => confirmAction("ลบรายการที่เลือก", "ยืนยันลบรายการ Ticket ที่เลือกหรือไม่", () => deleteTickets([...state.selectedTickets])));
  $("clearHistoryBtn").addEventListener("click", () => confirmAction("ล้างข้อมูล", "ยืนยันล้างข้อมูลรายการ Ticket ตามตัวกรองปัจจุบันหรือไม่", clearHistory));
  $("confirmCancel").addEventListener("click", () => $("confirmModal").classList.add("hidden"));
  $("selectAllTickets").addEventListener("change", (e) => {
    state.tickets.filter(ticketMatches).forEach((t) => e.target.checked ? state.selectedTickets.add(t.id) : state.selectedTickets.delete(t.id));
    renderTickets();
  });
  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      email: $("profileEmail").value.trim(),
      password: $("profilePassword").value,
      name: $("profileName").value.trim(),
      role: $("profileRole").value
    };
    const token = state.session?.access_token;
    const response = await fetch("/.netlify/functions/create-user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) return toast(body.error || "สร้างผู้ใช้ไม่สำเร็จ", true);
    event.target.reset();
    toast("บันทึกผู้ใช้งานแล้ว");
    await loadAll();
  });
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("change", handleDocumentChange);
}

async function handleDocumentClick(event) {
  const editId = event.target.dataset.editAgent;
  const deleteAgentId = event.target.dataset.deleteAgent;
  const deleteTicketId = event.target.dataset.deleteTicket;
  const deleteProfileId = event.target.dataset.deleteProfile;
  if (editId) {
    const a = state.agents.find((x) => x.id === editId);
    if (!a) return;
    $("agentId").value = a.id;
    $("agentName").value = a.name;
    setBusinessPicker("agent", a.business);
    $("agentStart").value = parseDigitalTime(a.work_start);
    $("agentBreakStart").value = parseDigitalTime(a.break_start);
    $("agentBreakEnd").value = parseDigitalTime(a.break_end);
    $("agentEnd").value = parseDigitalTime(a.work_end);
    showView("peopleView");
  }
  if (deleteAgentId) confirmAction("ลบ T2", "เมื่อลบแล้ว T2 จะถูกปิดใช้งานและนำออกจากคิว", () => removeAgent(deleteAgentId));
  if (deleteTicketId) confirmAction("ลบ Ticket", "ยืนยันลบรายการนี้หรือไม่", () => deleteTickets([deleteTicketId]));
  if (deleteProfileId) confirmAction("ลบผู้ใช้งาน", "ยืนยันลบโปรไฟล์ผู้ใช้งานนี้หรือไม่", async () => {
    const { error } = await sb.from("profiles").delete().eq("id", deleteProfileId);
    if (error) return toast(error.message, true);
    await loadAll();
  });
}

function handleDocumentChange(event) {
  const checkId = event.target.dataset.ticketCheck;
  const statusId = event.target.dataset.ticketStatus;
  if (checkId) {
    event.target.checked ? state.selectedTickets.add(checkId) : state.selectedTickets.delete(checkId);
    renderTickets();
  }
  if (statusId) updateTicketStatus(statusId, event.target.value);
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $(viewId).classList.add("active-view");
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === viewId));
  $("viewTitle").textContent = document.querySelector(`[data-view="${viewId}"]`)?.textContent || "Q Service Desk";
}

async function startApp() {
  $("appShell").classList.remove("auth-only");
  $("mainSidebar").classList.remove("hidden");
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  await loadProfile();
  await loadAll();
  sb.channel("service-desk-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, loadAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, loadAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadAll)
    .subscribe();
}

async function init() {
  if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");
  bindEvents();
  await loadRuntimeConfig();
  if (isConfigured) {
    sb = window.supabase.createClient(appConfig.SUPABASE_URL, appConfig.SUPABASE_ANON_KEY);
  }
  if (!requireConfigured()) return;
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (state.session) await startApp();
}

init();
